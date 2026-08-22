#include <emscripten.h>

#include <mruby.h>
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

enum picorb_worker_status {
  PICORB_WORKER_OK = 0,
  PICORB_WORKER_INVALID_STATE = -1,
  PICORB_WORKER_LOAD_ERROR = -2,
  PICORB_WORKER_DISPATCH_ERROR = -3,
  PICORB_WORKER_RESULT_TYPE_ERROR = -4,
  PICORB_WORKER_OUT_OF_MEMORY = -5
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
static picorb_worker_buffer result_buffer = { NULL, 0, 0 };
static picorb_worker_buffer error_buffer = { NULL, 0, 0 };

static int
buffer_assign(picorb_worker_buffer *buffer, const char *bytes, size_t len)
{
  if (buffer->capacity <= len) {
    size_t capacity = len + 1;
    char *ptr = (char *)realloc(buffer->ptr, capacity);
    if (!ptr) return PICORB_WORKER_OUT_OF_MEMORY;
    buffer->ptr = ptr;
    buffer->capacity = capacity;
  }

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

  /* Resolve the application contract during initialization. */
  struct RClass *handler = mrb_module_get(mrb, "PicoRubyWorker");
  mrb_value handler_value = mrb_obj_value(handler);
  if (!mrb_respond_to(mrb, handler_value, mrb_intern_lit(mrb, "fetch"))) {
    mrb_raise(mrb, E_RUNTIME_ERROR, "PicoRubyWorker.fetch is not defined");
  }
  dispatch_proc = mrb_const_get(mrb, handler_value,
                                mrb_intern_lit(mrb, "DISPATCH"));
  if (!mrb_proc_p(dispatch_proc)) {
    mrb_raise(mrb, E_RUNTIME_ERROR, "PicoRubyWorker::DISPATCH is not a Proc");
  }
  return mrb_nil_value();
}

static mrb_value
execute_dispatch_body(mrb_state *mrb, void *userdata)
{
  (void)userdata;
  return mrb_execute_proc_synchronously(mrb, dispatch_proc, 0, NULL);
}

EMSCRIPTEN_KEEPALIVE
int
picorb_worker_init(const uint8_t *mrb_data, size_t mrb_len)
{
  buffer_clear(&result_buffer);
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
int
picorb_worker_dispatch(const char *method, size_t method_len,
                       const char *url, size_t url_len)
{
  buffer_clear(&result_buffer);
  buffer_clear(&error_buffer);

  mrb_state *mrb = worker_mrb;
  if (!mrb || !method || !url) {
    set_error_literal("runtime is not initialized or request input is invalid");
    return PICORB_WORKER_INVALID_STATE;
  }

  int arena_index = mrb_gc_arena_save(mrb);
  mrb_value method_value = mrb_str_new(mrb, method, method_len);
  mrb_value url_value = mrb_str_new(mrb, url, url_len);
  mrb_gv_set(mrb, mrb_intern_lit(mrb, "$picorb_worker_method"), method_value);
  mrb_gv_set(mrb, mrb_intern_lit(mrb, "$picorb_worker_url"), url_value);

  mrb_bool error = FALSE;
  mrb_value result = mrb_protect_error(mrb, execute_dispatch_body, NULL, &error);
  mrb_gv_set(mrb, mrb_intern_lit(mrb, "$picorb_worker_method"), mrb_nil_value());
  mrb_gv_set(mrb, mrb_intern_lit(mrb, "$picorb_worker_url"), mrb_nil_value());
  if (error || mrb_exception_p(result)) {
    set_error_from_exception(mrb, result);
    mrb_gc_arena_restore(mrb, arena_index);
    return PICORB_WORKER_DISPATCH_ERROR;
  }
  if (!mrb_string_p(result)) {
    set_error_literal("PicoRubyWorker.fetch must return a String");
    mrb_gc_arena_restore(mrb, arena_index);
    return PICORB_WORKER_RESULT_TYPE_ERROR;
  }

  int status = buffer_assign(&result_buffer, RSTRING_PTR(result), RSTRING_LEN(result));
  if (status != PICORB_WORKER_OK) {
    set_error_literal("failed to allocate the response buffer");
  }
  mrb_gc_arena_restore(mrb, arena_index);
  return status;
}

EMSCRIPTEN_KEEPALIVE
uintptr_t
picorb_worker_result_ptr(void)
{
  return (uintptr_t)result_buffer.ptr;
}

EMSCRIPTEN_KEEPALIVE
size_t
picorb_worker_result_len(void)
{
  return result_buffer.len;
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
}

void
mrb_picoruby_worker_wasm_gem_final(mrb_state *mrb)
{
  (void)mrb;
}
