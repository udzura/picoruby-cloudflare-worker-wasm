module ActiveD1
  class Base
    def self.table_name
      @table_name ||= begin
        name = self.name.split("::").last
        word = name.gsub(/([A-Z]+)([A-Z][a-z])/, '\1_\2').gsub(/([a-z0-9])([A-Z])/, '\1_\2').downcase
        if word.size > 1 && word.end_with?("y") && !"aeiou".include?(word[-2, 1])
          word[0, word.size - 1] + "ies"
        elsif word.end_with?("s", "x", "z", "ch", "sh")
          word + "es"
        else
          word + "s"
        end
      end
    end

    def self.table_name=(name)
      raise SchemaError, "table already loaded" if @schema
      @table_name = name.to_s
    end

    def self.schema
      @schema ||= begin
        table = Schema::TABLES[table_name]
        raise SchemaError, "no generated schema for #{table_name}" unless table
        include table.accessors
        table
      end
    end

    def self.create(attributes = {})
      record = new(attributes)
      record.save
      record
    end

    def self.find(id)
      record = where(schema.primary_key => id).first unless id.nil?
      raise RecordNotFound, "#{table_name} record not found" unless record
      record
    end

    def self.where(conditions)
      Relation.new(self).where(conditions)
    end

    def self.order(columns)
      Relation.new(self).order(columns)
    end

    def self.limit(size)
      Relation.new(self).limit(size)
    end

    def self.offset(size)
      Relation.new(self).offset(size)
    end

    def self.all
      Relation.new(self).all
    end

    def self.first
      Relation.new(self).first
    end

    def self.count
      Relation.new(self).count
    end

    def self.exists?
      Relation.new(self).exists?
    end

    def self.query(sql, params = [])
      ActiveD1.statement(sql, params).rows.map do |row|
        record = new
        record.send(:load_row, row)
        record
      end
    end

    def initialize(attributes = {})
      @table = self.class.schema
      @attributes = {}
      @original = nil
      @destroyed = false
      assign(attributes)
    end

    def attributes
      @attributes.dup
    end

    def [](key)
      @attributes[key.to_s]
    end

    def []=(key, value)
      name = @table.column_name(key)
      raise SchemaError, "read-only column #{name}" unless @table.columns[name][:writable]
      if @original && name == @table.primary_key
        raise SchemaError, "cannot assign a persisted primary key"
      end
      @attributes[name] = value
    end

    def save
      raise RecordNotFound, "record was destroyed" if @destroyed
      if @original
        id = persisted_key
        keys = @attributes.keys.select do |name|
          !@original.key?(name) || @attributes[name] != @original[name]
        end
        return true if keys.empty?
        assignments = keys.map { |key| @table.sql_column(key) + " = ?" }
        sql = "UPDATE #{@table.sql_name} SET #{assignments.join(', ')} WHERE #{@table.sql_column(@table.primary_key)} = ?"
        params = keys.map { |key| @attributes[key] } + [id]
      else
        keys = @attributes.keys
        sql = "INSERT INTO #{@table.sql_name}"
        if keys.empty?
          sql += " DEFAULT VALUES"
        else
          columns = keys.map { |key| @table.sql_column(key) }
          sql += " (#{columns.join(', ')}) VALUES (#{keys.map { '?' }.join(', ')})"
        end
        params = keys.map { |key| @attributes[key] }
      end
      row = ActiveD1.statement(sql + " RETURNING *", params).first
      raise RecordNotFound, "record no longer exists" unless row
      load_row(row)
      true
    end

    def update(attributes)
      assign(attributes)
      save
    end

    def destroy
      id = persisted_key
      sql = "DELETE FROM #{@table.sql_name} WHERE #{@table.sql_column(@table.primary_key)} = ?"
      result = ActiveD1.statement(sql, [id]).run
      raise RecordNotFound, "record no longer exists" if result.changes == 0
      @destroyed = true
      self
    end

    private

    def persisted_key
      key = @table.primary_key
      if @destroyed || !@original || @original[key].nil?
        raise RecordNotFound, "record has no persisted primary key"
      end
      @original[key]
    end

    def assign(attributes)
      attributes.each { |key, value| self[key] = value }
    end

    def load_row(row)
      @attributes = row
      @original = {}
      row.each do |key, value|
        # Keep a snapshot for in-place string edits. Generated columns and keys
        # are read-only even when exposed as mutable Ruby strings.
        if value.is_a?(String)
          metadata = @table.columns[key]
          value.freeze if key == @table.primary_key || !metadata || !metadata[:writable]
          value = value.dup unless value.frozen?
        end
        @original[key] = value
      end
    end
  end
end
