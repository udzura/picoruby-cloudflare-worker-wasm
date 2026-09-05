module PicoRubyWorker
  class RackError < RuntimeError
  end

  module RackWire
    REQUEST_MAGIC = "PRQ1"
    REQUEST_FIELD_COUNT = 8
    MAX_HEADER_COUNT = 256

    class Reader
      def initialize(frame)
        @frame = frame
        @offset = 0
      end

      def read_magic(expected)
        actual = read_bytes(expected.bytesize)
        raise RackError, "unsupported request frame" unless actual == expected
      end

      def read_u32
        frame = @frame
        offset = @offset
        raise RackError, "truncated request frame" if offset + 4 > frame.bytesize

        value = frame.getbyte(offset)
        value |= frame.getbyte(offset + 1) << 8
        value |= frame.getbyte(offset + 2) << 16
        value |= frame.getbyte(offset + 3) << 24
        @offset = offset + 4
        value
      end

      def read_string
        read_bytes(read_u32)
      end

      def read_bytes(length)
        frame = @frame
        offset = @offset
        raise RackError, "truncated request frame" if length < 0 || offset + length > frame.bytesize

        value = frame.byteslice(offset, length)
        @offset = offset + length
        value
      end

      def finish!
        raise RackError, "request frame has trailing bytes" unless @offset == @frame.bytesize
      end
    end

    def self.decode_request(frame)
      reader = Reader.new(frame)
      reader.read_magic(REQUEST_MAGIC)

      fields = []
      index = 0
      while index < REQUEST_FIELD_COUNT
        fields << reader.read_string
        index += 1
      end

      header_count = reader.read_u32
      raise RackError, "too many request headers" if header_count > MAX_HEADER_COUNT

      headers = []
      index = 0
      while index < header_count
        headers << reader.read_string
        headers << reader.read_string
        index += 1
      end

      body = reader.read_string
      reader.finish!
      [fields, headers, body]
    end
  end

  class RackInput
    def initialize(data)
      @data = data
      @offset = 0
      @closed = false
    end

    def read(length = nil, buffer = nil)
      raise RackError, "rack.input is closed" if @closed
      unless length.nil? || length.is_a?(Integer)
        raise ArgumentError, "rack.input length must be an Integer or nil"
      end
      raise ArgumentError, "negative length" if length && length < 0
      unless buffer.nil? || buffer.is_a?(String)
        raise ArgumentError, "rack.input buffer must be a String"
      end

      data = @data
      offset = @offset
      if length.nil?
        chunk = data.byteslice(offset, data.bytesize - offset)
        @offset = data.bytesize
      elsif length == 0
        chunk = ""
      elsif offset >= data.bytesize
        chunk = nil
      else
        remaining = data.bytesize - offset
        length = remaining if length > remaining
        chunk = data.byteslice(offset, length)
        @offset = offset + length
      end

      return chunk unless buffer && chunk

      buffer.replace(chunk)
      buffer
    end

    def gets
      raise RackError, "rack.input is closed" if @closed

      data = @data
      offset = @offset
      return nil if offset >= data.bytesize

      newline = data.index("\n", offset)
      length = newline ? newline - offset + 1 : data.bytesize - offset
      line = data.byteslice(offset, length)
      @offset = offset + length
      line
    end

    def each
      # Rack requires an IO-like #each interface; generic block iteration is
      # unavoidable here because callers provide the block.
      while (line = gets)
        yield line
      end
      self
    end

    def rewind
      raise RackError, "rack.input is closed" if @closed

      @offset = 0
      0
    end

    def close
      @closed = true
      nil
    end

    def closed?
      @closed
    end
  end

  class RackErrors
    def initialize
      @buffer = ""
    end

    def write(message)
      string = message.to_s
      @buffer = @buffer + string
      string.bytesize
    end

    def puts(message)
      string = message.to_s
      @buffer = @buffer + string
      @buffer = @buffer + "\n" unless string.bytesize > 0 && string.getbyte(string.bytesize - 1) == 10
      nil
    end

    def flush
      nil
    end

    def string
      @buffer
    end
  end

  module RackAdapter
    NO_ENTITY_STATUSES = [204, 205, 304]

    def self.register(app)
      raise RackError, "Rack application must respond to call" unless app.respond_to?(:call)

      @app = app
    end

    def self.unregister
      @app = nil
    end

    def self.registered?
      !@app.nil?
    end

    def self.dispatch(frame)
      raise RackError, "Rack application is not registered" unless @app

      request = RackWire.decode_request(frame)
      env = build_env(request)
      status = nil
      headers = nil
      body = nil
      result = nil
      error = nil

      begin
        response = @app.call(env)
        raise RackError, "Rack response must be a three-element Array" unless response.is_a?(Array) && response.size == 3

        status = response[0]
        headers = response[1]
        body = response[2]
        normalized_headers = normalize_headers(status, headers)
        normalized_body = consume_body(env, status, body)
        result = [status, normalized_headers, normalized_body]
      rescue => exception
        error = exception
      ensure
        if body && body.respond_to?(:close)
          begin
            body.close
          rescue => close_error
            error = close_error unless error
          end
        end
        run_response_finished(env, status, headers, error)
      end

      raise error if error

      result
    end

    def self.build_env(request)
      fields = request[0]
      headers = request[1]
      body = request[2]
      method = fields[0]
      scheme = fields[1]
      server_name = fields[2]
      server_port = fields[3]
      host = fields[4]
      path = fields[5]
      query = fields[6]
      protocol = fields[7]

      raise RackError, "REQUEST_METHOD is empty" if method.empty?
      path = "/" if path.empty?

      env = {
        "REQUEST_METHOD" => method,
        "SCRIPT_NAME" => "",
        "PATH_INFO" => path,
        "REQUEST_PATH" => path,
        "QUERY_STRING" => query,
        "SERVER_NAME" => server_name,
        "SERVER_PORT" => server_port,
        "SERVER_PROTOCOL" => protocol,
        "HTTP_HOST" => host,
        "rack.url_scheme" => scheme,
        "rack.input" => RackInput.new(body),
        "rack.errors" => RackErrors.new,
        "rack.response_finished" => [],
        "cloudflare.env" => Cloudflare::Environment.new,
      }

      index = 0
      header_size = headers.size
      while index < header_size
        add_header(env, headers[index], headers[index + 1])
        index += 2
      end
      env
    end

    def self.add_header(env, name, value)
      lower_name = name.downcase
      if lower_name == "host"
        env["HTTP_HOST"] = value
        return
      end

      key = if lower_name == "content-type"
        "CONTENT_TYPE"
      elsif lower_name == "content-length"
        "CONTENT_LENGTH"
      else
        header_key = "HTTP_#{lower_name.upcase}"
        index = 5
        length = header_key.bytesize
        while index < length
          header_key.setbyte(index, 95) if header_key.getbyte(index) == 45
          index += 1
        end
        header_key
      end

      existing = env[key]
      env[key] = existing ? "#{existing},#{value}" : value
    end

    def self.normalize_headers(status, headers)
      raise RackError, "Rack status must be an Integer between 200 and 599" unless status.is_a?(Integer) && status >= 200 && status <= 599
      raise RackError, "Rack headers must be a Hash" unless headers.is_a?(Hash)

      no_entity = no_entity_status?(status)
      normalized = []
      keys = headers.keys
      index = 0
      keys_size = keys.size
      while index < keys_size
        name = keys[index]
        raise RackError, "Rack header name must be a String" unless name.is_a?(String)
        raise RackError, "Rack headers must not contain status" if name == "status"

        if !starts_with_rack_prefix?(name) && !(no_entity && content_header?(name))
          validate_header_name!(name)
          append_header_values(normalized, name, headers[name])
        end
        index += 1
      end
      normalized
    end

    def self.append_header_values(normalized, name, value)
      if value.is_a?(String)
        validate_header_value!(value)
        normalized << name
        normalized << value
      elsif value.is_a?(Array)
        index = 0
        value_size = value.size
        while index < value_size
          item = value[index]
          raise RackError, "Rack header values must be Strings" unless item.is_a?(String)

          validate_header_value!(item)
          normalized << name
          normalized << item
          index += 1
        end
      else
        raise RackError, "Rack header value must be a String or Array of Strings"
      end
    end

    def self.validate_header_name!(name)
      raise RackError, "Rack header name is empty" if name.empty?

      index = 0
      length = name.bytesize
      while index < length
        byte = name.getbyte(index)
        valid = byte >= 97 && byte <= 122
        valid ||= byte >= 48 && byte <= 57
        valid ||= byte == 33 || byte == 35 || byte == 36 || byte == 37
        valid ||= byte == 38 || byte == 39 || byte == 42 || byte == 43
        valid ||= byte == 45 || byte == 46 || byte == 94 || byte == 95
        valid ||= byte == 96 || byte == 124 || byte == 126
        raise RackError, "invalid Rack response header name" unless valid

        index += 1
      end
    end

    def self.validate_header_value!(value)
      index = 0
      length = value.bytesize
      while index < length
        byte = value.getbyte(index)
        raise RackError, "invalid Rack response header value" if byte == 0 || byte == 10 || byte == 13

        index += 1
      end
    end

    def self.consume_body(env, status, body)
      raise RackError, "Rack body must respond to each" unless body.respond_to?(:each)
      return "" if env["REQUEST_METHOD"] == "HEAD" || no_entity_status?(status)

      content = ""
      if body.is_a?(Array)
        index = 0
        body_size = body.size
        while index < body_size
          content = append_body_part(content, body[index])
          index += 1
        end
      else
        # Rack permits arbitrary enumerable response bodies, so indexed
        # traversal is not available for this compatibility path.
        body.each do |part|
          content = append_body_part(content, part)
        end
      end
      content
    end

    def self.append_body_part(content, part)
      raise RackError, "Rack body must yield Strings" unless part.is_a?(String)

      content + part
    end

    def self.run_response_finished(env, status, headers, error)
      callbacks = env["rack.response_finished"]
      return unless callbacks.is_a?(Array)

      index = callbacks.size - 1
      while index >= 0
        callback = callbacks[index]
        begin
          callback.call(env, status, headers, error) if callback.respond_to?(:call)
        rescue
          # Rack requires response-finished callbacks not to escape.
        end
        index -= 1
      end
    end

    def self.no_entity_status?(status)
      index = 0
      while index < NO_ENTITY_STATUSES.size
        return true if NO_ENTITY_STATUSES[index] == status

        index += 1
      end
      false
    end

    def self.starts_with_rack_prefix?(name)
      name.bytesize >= 5 && name.byteslice(0, 5) == "rack."
    end

    def self.content_header?(name)
      name == "content-type" || name == "content-length"
    end
  end

  # mrb-task's synchronous executor currently accepts no arguments, so the C
  # boundary pins the request frame in this private slot during dispatch.
  DISPATCH = -> {
    RackAdapter.dispatch($picorb_worker_request_frame)
  }
end

module Rackup
  module Handler
    module CloudflareWorker
      def self.run(app, _options = nil)
        PicoRubyWorker::RackAdapter.register(app)
        yield self if block_given?
        self
      end

      def self.shutdown
        PicoRubyWorker::RackAdapter.unregister
      end
    end
  end
end

module Cloudflare
  class Environment
    def initialize
      @bindings = {}
    end

    def binding(name, expected_class = nil)
      binding_name = name.to_s
      if @bindings.key?(binding_name)
        value = @bindings[binding_name]
      else
        type = Cloudflare.__env_binding_type(binding_name)
        if type == "kv"
          value = KV.new(binding_name)
        elsif type == "queue"
          value = Queue.new(binding_name)
        else
          value = Cloudflare.__env_get(binding_name)
          raise NoMethodError, "undefined Cloudflare binding `#{binding_name}'" if value.nil?
        end
        @bindings[binding_name] = value
      end

      if expected_class && !value.is_a?(expected_class)
        raise ArgumentError, "Cloudflare binding `#{binding_name}' is not a #{expected_class}"
      end
      value
    end

    def method_missing(name, *arguments, &block)
      return super unless arguments.empty? && block.nil?

      binding(name)
    end

    def inspect
      "#<Cloudflare::Environment>"
    end

    def self.from_rack(rack_env)
      environment = rack_env["cloudflare.env"]
      return environment if environment.is_a?(self)

      raise ArgumentError, "Rack env does not contain cloudflare.env"
    end
  end

  class Binding
    def initialize(binding_name)
      @binding_name = binding_name
    end

    def binding_name
      @binding_name
    end

    def self.from_env(rack_env, binding_name)
      Environment.from_rack(rack_env).binding(binding_name, self)
    end
  end

  class KV < Binding
    DEFAULT_BINDING = "PICORUBY_KV"

    def initialize(binding_name = DEFAULT_BINDING)
      super(binding_name)
    end

    def get(key)
      Cloudflare.__kv_get(@binding_name, key)
    end

    def put(key, value, ttl: nil)
      options = {}
      options[:ttl] = ttl unless ttl.nil?
      Cloudflare.__kv_put(@binding_name, key, value, JSON.generate(options))
    end

    def set(key, value, **options)
      put(key, value, **options)
    end

    def self.get(key)
      new.get(key)
    end

    def self.put(key, value, **options)
      new.put(key, value, **options)
    end

    def self.set(key, value, **options)
      new.set(key, value, **options)
    end
  end

  class Queue < Binding
    def send(message)
      Cloudflare.__queue_send(@binding_name, message)
    end
  end

  def self.kv_get(key)
    KV.get(key)
  end

  def self.kv_set(key, value, **options)
    KV.set(key, value, **options)
  end
end
