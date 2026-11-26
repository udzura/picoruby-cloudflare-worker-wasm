module ActiveD1
  class Relation
    def initialize(model, filters = [], params = [], ordering = [], limit = nil, offset = nil)
      @model = model
      @table = model.schema
      @filters, @params, @ordering = filters, params, ordering
      @limit, @offset = limit, offset
    end

    def where(conditions)
      filters = @filters.dup
      params = @params.dup
      conditions.each do |key, value|
        column = @table.sql_column(key)
        if value.nil?
          filters << column + " IS NULL"
        else
          filters << column + " = ?"
          params << (value.is_a?(String) ? value.dup : value)
        end
      end
      Relation.new(@model, filters, params, @ordering, @limit, @offset)
    end

    def order(columns)
      ordering = @ordering.dup
      columns.each do |key, direction|
        dir = direction.to_s.upcase
        raise ArgumentError, "order must be ASC or DESC" unless dir == "ASC" || dir == "DESC"
        ordering << @table.sql_column(key) + " " + dir
      end
      Relation.new(@model, @filters, @params, ordering, @limit, @offset)
    end

    def limit(size)
      Relation.new(@model, @filters, @params, @ordering, page_size(size), @offset)
    end

    def offset(size)
      Relation.new(@model, @filters, @params, @ordering, @limit, page_size(size))
    end

    def all
      sql, params = select_sql("*", @limit)
      @model.query(sql, params)
    end

    def first
      relation = @ordering.empty? ? order(@table.primary_key => :asc) : self
      relation.limit(@limit == 0 ? 0 : 1).all.first
    end

    def count
      if @limit || @offset
        inner, params = select_sql("1", @limit)
        sql = "SELECT COUNT(*) AS n FROM (#{inner})"
      else
        sql, params = select_sql("COUNT(*) AS n", nil)
      end
      ActiveD1.statement(sql, params).first("n")
    end

    def exists?
      sql, params = select_sql("1 AS present", @limit == 0 ? 0 : 1)
      !ActiveD1.statement(sql, params).first.nil?
    end

    private

    def page_size(size)
      raise ArgumentError, "expected nonnegative integer" unless size.is_a?(Integer) && size >= 0
      size
    end

    def select_sql(projection, limit)
      params = @params.dup
      sql = "SELECT #{projection} FROM #{@table.sql_name}"
      sql += " WHERE " + @filters.join(" AND ") unless @filters.empty?
      sql += " ORDER BY " + @ordering.join(", ") unless @ordering.empty?
      if limit || @offset
        sql += " LIMIT ?"
        params << (limit || -1)
      end
      if @offset
        sql += " OFFSET ?"
        params << @offset
      end
      [sql, params]
    end
  end
end
