#include <emscripten.h>

#include <mruby.h>
#include <mruby/array.h>
#include <mruby/class.h>
#include <mruby/dump.h>
#include <mruby/error.h>
#include <mruby/gc.h>
#include <mruby/proc.h>
#include <mruby/string.h>
#include <mruby/variable.h>

#include <task.h>
#include <version.h>

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define PICORB_WORKER_ABI_VERSION 1u
#define PICORB_WORKER_REQUEST_MAGIC "PRQ1"
#define PICORB_WORKER_RESPONSE_MAGIC "PRR1"
#define PICORB_WORKER_MAX_REQUEST_FRAME_SIZE (2u * 1024u * 1024u)
#define PICORB_WORKER_MAX_RESPONSE_FRAME_SIZE (8u * 1024u * 1024u)

enum picorb_worker_status {
  PICORB_WORKER_OK = 0,
  PICORB_WORKER_INVALID_STATE = -1,
  PICORB_WORKER_LOAD_ERROR = -2,
  PICORB_WORKER_INVALID_REQUEST = -3,
  PICORB_WORKER_DISPATCH_ERROR = -4,
  PICORB_WORKER_INVALID_RESPONSE = -5,
  PICORB_WORKER_OUT_OF_MEMORY = -6
};

typedef struct picorb_worker_buffer {
  char *ptr;
  size_t len;
  size_t capacity;
} picorb_worker_buffer;

typedef struct picorb_worker_load_args {
  const uint8_t *mrb_data;
  size_t mrb_len;
} picorb_worker_load_args;

static mrb_state *worker_mrb = NULL;
static mrb_value dispatch_proc;
static picorb_worker_buffer response_buffer = { NULL, 0, 0 };
static picorb_worker_buffer error_buffer = { NULL, 0, 0 };

EM_ASYNC_JS(int, picorb_worker_jspi_add, (int left, int right), {
  return await Module["picorbWorkerJspiAdd"](left, right);
});

static mrb_value
mrb_jspi_probe_add(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_int left;
  mrb_int right;
  mrb_get_args(mrb, "ii", &left, &right);
  return mrb_int_value(mrb, picorb_worker_jspi_add((int)left, (int)right));
}

static int
buffer_reserve(picorb_worker_buffer *buffer, size_t len)
{
  if (len == SIZE_MAX) return PICORB_WORKER_OUT_OF_MEMORY;
  if (buffer->capacity <= len) {
    size_t capacity = len + 1;
    char *ptr = (char *)realloc(buffer->ptr, capacity);
    if (!ptr) return PICORB_WORKER_OUT_OF_MEMORY;
    buffer->ptr = ptr;
    buffer->capacity = capacity;
  }
  return PICORB_WORKER_OK;
}

static int
buffer_assign(picorb_worker_buffer *buffer, const char *bytes, size_t len)
{
  int status = buffer_reserve(buffer, len);
  if (status != PICORB_WORKER_OK) return status;

  if (len > 0) memcpy(buffer->ptr, bytes, len);
  buffer->ptr[len] = '\0';
  buffer->len = len;
  return PICORB_WORKER_OK;
}

static void
buffer_clear(picorb_worker_buffer *buffer)
{
  buffer->len = 0;
  if (buffer->ptr) buffer->ptr[0] = '\0';
}

static void
buffer_release(picorb_worker_buffer *buffer)
{
  free(buffer->ptr);
  buffer->ptr = NULL;
  buffer->len = 0;
  buffer->capacity = 0;
}

static void
set_error_literal(const char *message)
{
  (void)buffer_assign(&error_buffer, message, strlen(message));
}

static mrb_value
inspect_body(mrb_state *mrb, void *userdata)
{
  mrb_value *value = (mrb_value *)userdata;
  return mrb_inspect(mrb, *value);
}

static void
set_error_from_exception(mrb_state *mrb, mrb_value exception)
{
  mrb_bool error = FALSE;
  mrb_value inspected = mrb_protect_error(mrb, inspect_body, &exception, &error);
  if (!error && mrb_string_p(inspected)) {
    if (buffer_assign(&error_buffer, RSTRING_PTR(inspected), RSTRING_LEN(inspected)) == PICORB_WORKER_OK) {
      return;
    }
  }
  set_error_literal("Ruby exception");
}

static mrb_value
load_app_body(mrb_state *mrb, void *userdata)
{
  picorb_worker_load_args *args = (picorb_worker_load_args *)userdata;
  mrb_irep *irep = mrb_read_irep_buf(mrb, args->mrb_data, args->mrb_len);
  if (!irep) {
    mrb_raise(mrb, E_SCRIPT_ERROR, "failed to load app bytecode");
  }

  struct RProc *proc = mrb_proc_new(mrb, irep);
  proc->c = NULL;
  mrb_value result = mrb_execute_proc_synchronously(mrb, mrb_obj_value(proc), 0, NULL);
  if (mrb_exception_p(result)) {
    mrb_exc_raise(mrb, result);
  }

  struct RClass *worker = mrb_module_get(mrb, "PicoRubyWorker");
  mrb_value worker_value = mrb_obj_value(worker);
  dispatch_proc = mrb_const_get(mrb, worker_value, mrb_intern_lit(mrb, "DISPATCH"));
  if (!mrb_proc_p(dispatch_proc)) {
    mrb_raise(mrb, E_RUNTIME_ERROR, "PicoRubyWorker::DISPATCH is not a Proc");
  }

  struct RClass *adapter = mrb_module_get_under(mrb, worker, "RackAdapter");
  mrb_value registered = mrb_funcall(mrb, mrb_obj_value(adapter), "registered?", 0);
  if (!mrb_test(registered)) {
    mrb_raise(mrb, E_RUNTIME_ERROR, "Rack application is not registered");
  }
  return mrb_nil_value();
}

static mrb_value
execute_dispatch_body(mrb_state *mrb, void *userdata)
{
  (void)userdata;
  return mrb_execute_proc_synchronously(mrb, dispatch_proc, 0, NULL);
}

static mrb_bool
checked_add(size_t *total, size_t value)
{
  if (value > SIZE_MAX - *total) return FALSE;
  *total += value;
  return TRUE;
}

static void
write_u32(uint8_t **cursor, uint32_t value)
{
  uint8_t *ptr = *cursor;
  ptr[0] = (uint8_t)(value & 0xffu);
  ptr[1] = (uint8_t)((value >> 8) & 0xffu);
  ptr[2] = (uint8_t)((value >> 16) & 0xffu);
  ptr[3] = (uint8_t)((value >> 24) & 0xffu);
  *cursor = ptr + 4;
}

static mrb_bool
add_encoded_string_size(size_t *total, mrb_value string)
{
  if (!mrb_string_p(string)) return FALSE;
  size_t len = (size_t)RSTRING_LEN(string);
  if (len > UINT32_MAX) return FALSE;
  return checked_add(total, 4) && checked_add(total, len);
}

static void
write_encoded_string(uint8_t **cursor, mrb_value string)
{
  uint32_t len = (uint32_t)RSTRING_LEN(string);
  write_u32(cursor, len);
  if (len > 0) {
    memcpy(*cursor, RSTRING_PTR(string), len);
    *cursor += len;
  }
}

static int
encode_response(mrb_state *mrb, mrb_value result)
{
  if (!mrb_array_p(result) || RARRAY_LEN(result) != 3) {
    set_error_literal("Rack adapter must return a three-element Array");
    return PICORB_WORKER_INVALID_RESPONSE;
  }

  mrb_value status_value = mrb_ary_ref(mrb, result, 0);
  mrb_value headers = mrb_ary_ref(mrb, result, 1);
  mrb_value body = mrb_ary_ref(mrb, result, 2);
  if (!mrb_integer_p(status_value) || !mrb_array_p(headers) || !mrb_string_p(body)) {
    set_error_literal("Rack adapter returned invalid response types");
    return PICORB_WORKER_INVALID_RESPONSE;
  }

  mrb_int status_integer = mrb_integer(status_value);
  mrb_int header_items = RARRAY_LEN(headers);
  if (status_integer < 200 || status_integer > 599 || header_items < 0 || (header_items % 2) != 0) {
    set_error_literal("Rack adapter returned an invalid status or header list");
    return PICORB_WORKER_INVALID_RESPONSE;
  }

  size_t total = 12;
  mrb_int index = 0;
  while (index < header_items) {
    mrb_value name = mrb_ary_ref(mrb, headers, index);
    mrb_value value = mrb_ary_ref(mrb, headers, index + 1);
    if (!add_encoded_string_size(&total, name) || !add_encoded_string_size(&total, value)) {
      set_error_literal("Rack adapter returned invalid response headers");
      return PICORB_WORKER_INVALID_RESPONSE;
    }
    index += 2;
  }
  if (!add_encoded_string_size(&total, body) || total > PICORB_WORKER_MAX_RESPONSE_FRAME_SIZE) {
    set_error_literal("Rack response frame is too large");
    return PICORB_WORKER_INVALID_RESPONSE;
  }

  int buffer_status = buffer_reserve(&response_buffer, total);
  if (buffer_status != PICORB_WORKER_OK) {
    set_error_literal("failed to allocate the response buffer");
    return buffer_status;
  }

  uint8_t *cursor = (uint8_t *)response_buffer.ptr;
  memcpy(cursor, PICORB_WORKER_RESPONSE_MAGIC, 4);
  cursor += 4;
  write_u32(&cursor, (uint32_t)status_integer);
  write_u32(&cursor, (uint32_t)(header_items / 2));
  index = 0;
  while (index < header_items) {
    write_encoded_string(&cursor, mrb_ary_ref(mrb, headers, index));
    write_encoded_string(&cursor, mrb_ary_ref(mrb, headers, index + 1));
    index += 2;
  }
  write_encoded_string(&cursor, body);
  response_buffer.ptr[total] = '\0';
  response_buffer.len = total;
  return PICORB_WORKER_OK;
}

EMSCRIPTEN_KEEPALIVE
uint32_t
picorb_worker_abi_version(void)
{
  return PICORB_WORKER_ABI_VERSION;
}

EMSCRIPTEN_KEEPALIVE
int
picorb_worker_init(const uint8_t *mrb_data, size_t mrb_len)
{
  buffer_clear(&response_buffer);
  buffer_clear(&error_buffer);

  if (worker_mrb || !mrb_data || mrb_len == 0) {
    set_error_literal("runtime is already initialized or app bytecode is empty");
    return PICORB_WORKER_INVALID_STATE;
  }

  mrb_state *mrb = mrb_open();
  if (!mrb) {
    set_error_literal("failed to initialize the PicoRuby VM");
    return PICORB_WORKER_OUT_OF_MEMORY;
  }

  picorb_worker_load_args args = { mrb_data, mrb_len };
  mrb_bool error = FALSE;
  mrb_value result = mrb_protect_error(mrb, load_app_body, &args, &error);
  if (error) {
    set_error_from_exception(mrb, result);
    mrb_close(mrb);
    return PICORB_WORKER_LOAD_ERROR;
  }

  mrb_gc_register(mrb, dispatch_proc);
  worker_mrb = mrb;
  return PICORB_WORKER_OK;
}

EMSCRIPTEN_KEEPALIVE
void
picorb_worker_close(void)
{
  if (worker_mrb) {
    mrb_close(worker_mrb);
    worker_mrb = NULL;
  }
  dispatch_proc = mrb_nil_value();
  buffer_release(&response_buffer);
  buffer_release(&error_buffer);
}

EMSCRIPTEN_KEEPALIVE
int
picorb_worker_dispatch_v1(const uint8_t *request_frame, size_t request_frame_len)
{
  buffer_clear(&response_buffer);
  buffer_clear(&error_buffer);

  mrb_state *mrb = worker_mrb;
  if (!mrb || !request_frame) {
    set_error_literal("runtime is not initialized or request input is invalid");
    return PICORB_WORKER_INVALID_STATE;
  }
  if (request_frame_len < 4 || request_frame_len > PICORB_WORKER_MAX_REQUEST_FRAME_SIZE ||
      memcmp(request_frame, PICORB_WORKER_REQUEST_MAGIC, 4) != 0) {
    set_error_literal("invalid or unsupported request frame");
    return PICORB_WORKER_INVALID_REQUEST;
  }

  int arena_index = mrb_gc_arena_save(mrb);
  mrb_sym request_frame_global = mrb_intern_lit(mrb, "$picorb_worker_request_frame");
  mrb_gv_set(mrb, request_frame_global,
             mrb_str_new(mrb, (const char *)request_frame, request_frame_len));
  mrb_bool error = FALSE;
  mrb_value result = mrb_protect_error(mrb, execute_dispatch_body, NULL, &error);
  mrb_gv_set(mrb, request_frame_global, mrb_nil_value());
  if (error || mrb_exception_p(result)) {
    set_error_from_exception(mrb, result);
    mrb_gc_arena_restore(mrb, arena_index);
    return PICORB_WORKER_DISPATCH_ERROR;
  }

  int status = encode_response(mrb, result);
  mrb_gc_arena_restore(mrb, arena_index);
  return status;
}

EMSCRIPTEN_KEEPALIVE
uintptr_t
picorb_worker_response_ptr(void)
{
  return (uintptr_t)response_buffer.ptr;
}

EMSCRIPTEN_KEEPALIVE
size_t
picorb_worker_response_len(void)
{
  return response_buffer.len;
}

EMSCRIPTEN_KEEPALIVE
uintptr_t
picorb_worker_error_ptr(void)
{
  return (uintptr_t)error_buffer.ptr;
}

EMSCRIPTEN_KEEPALIVE
size_t
picorb_worker_error_len(void)
{
  return error_buffer.len;
}

void
mrb_picoruby_worker_wasm_gem_init(mrb_state *mrb)
{
  struct RClass *worker = mrb_define_module(mrb, "PicoRubyWorker");
  mrb_define_const(mrb, worker, "VERSION", mrb_str_new_cstr(mrb, picorb_version()));
  mrb_define_const(mrb, worker, "ABI_VERSION", mrb_fixnum_value(PICORB_WORKER_ABI_VERSION));

  struct RClass *jspi_probe = mrb_define_module_under(mrb, worker, "JSPIProbe");
  mrb_define_class_method_id(mrb, jspi_probe, MRB_SYM(add), mrb_jspi_probe_add, MRB_ARGS_REQ(2));
}

void
mrb_picoruby_worker_wasm_gem_final(mrb_state *mrb)
{
  (void)mrb;
}
