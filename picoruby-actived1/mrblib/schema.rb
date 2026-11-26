module ActiveD1
  class RecordNotFound < StandardError; end
  class SchemaError < StandardError; end

  module Schema
    TABLES = {}

    def self.register(name, primary_key, columns, accessors)
      TABLES[name] = Table.new(name, primary_key, columns, accessors)
    end

    class Table
      attr_reader :name, :primary_key, :columns, :accessors, :sql_name

      def initialize(name, primary_key, columns, accessors)
        @name, @primary_key, @columns, @accessors = name, primary_key, columns, accessors
        @sql_name = quote(name)
      end

      def column_name(key)
        name = key.to_s
        raise SchemaError, "unknown column #{@name}.#{name}" unless @columns.key?(name)
        name
      end

      def sql_column(key)
        quote(column_name(key))
      end

      private

      def quote(name)
        '"' + name.gsub('"', '""') + '"'
      end
    end
  end

  # A Worker dispatch owns its Wasm VM. Restore the scope on exceptions and nesting.
  def self.with_database(database)
    previous = @database
    @database = database
    begin
      yield
    ensure
      @database = previous
    end
  end

  def self.statement(sql, params)
    raise "ActiveD1 requires a request-scoped database" unless @database
    @database.prepare(sql).bind(*params)
  end
end
