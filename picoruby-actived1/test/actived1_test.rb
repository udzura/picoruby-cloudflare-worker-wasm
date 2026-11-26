require "test/unit"
require_relative "../lib/actived1/generator"
require_relative "../mrblib/schema"
require_relative "../mrblib/relation"

class ActiveD1Test < Test::Unit::TestCase
  class BlogEntry < ActiveD1::Base; end
  class Address < ActiveD1::Base; end
  class Day < ActiveD1::Base; end
  class Archived < ActiveD1::Base
    self.table_name = "blog_entries"
  end

  def column(name, type, pk: 0, hidden: 0, required: 0, default: nil)
    { "table_name" => "blog_entries", "name" => name, "type" => type, "pk" => pk,
      "hidden" => hidden, "required" => required, "dflt_value" => default }
  end

  def setup
    @columns = [column("key", "TEXT", pk: 1), column("title", "TEXT", required: 1, default: "'draft'"),
                column("length", "INTEGER", hidden: 3), column('a"b', ""), column("save", ""), column("_1", "")]
    # Load exactly the source that an application's bytecode compiler receives.
    eval(ActiveD1::Generator.render(@columns), TOPLEVEL_BINDING) unless ActiveD1::Schema::TABLES.key?("blog_entries")
    @db = RecordingDatabase.new
  end

  class RecordingDatabase
    attr_reader :calls
    attr_accessor :result
    def initialize
      @calls = []
    end

    def prepare(sql)
      @sql = sql
      self
    end

    def bind(*params)
      @calls << [@sql, params]
      self
    end

    def first(column = nil)
      column ? @result[column] : @result
    end

    def rows
      @result
    end

    def run
      self
    end

    def changes
      @result
    end
  end

  def test_schema_and_model_conventions
    assert_equal "blog_entries", BlogEntry.table_name
    assert_equal "addresses", Address.table_name
    assert_equal "days", Day.table_name
    assert_equal "blog_entries", Archived.table_name
    assert_equal "key", Archived.schema.primary_key
    assert_equal({ type: "TEXT", not_null: true, default_sql: "'draft'", writable: true }, BlogEntry.schema.columns["title"])
    model = BlogEntry.new(title: "Ruby", "save" => 3, "_1" => 4)
    assert_equal "Ruby", model.title
    assert_equal 3, model[:save]
    assert_equal 4, model["_1"]
    assert_raise(ActiveD1::SchemaError) { model[:length] = 1 }
    assert_raise(ActiveD1::SchemaError) { model[:unknown] = nil }
  end

  def test_lazy_chains_snapshot_inputs_and_bind_pagination
    ActiveD1.with_database(@db) do
      title = +"Ruby's DB"
      base = BlogEntry.where(title: title)
      relation = base.where('a"b' => nil).order(title: :desc).limit(2).offset(1)
      title.replace("changed")
      assert_empty @db.calls
      @db.result = []
      assert_equal [], relation.all
      assert_equal ['SELECT * FROM "blog_entries" WHERE "title" = ? AND "a""b" IS NULL ORDER BY "title" DESC LIMIT ? OFFSET ?', ["Ruby's DB", 2, 1]], @db.calls.last
      base.all
      assert_equal ['SELECT * FROM "blog_entries" WHERE "title" = ?', ["Ruby's DB"]], @db.calls.last
      assert_raise(ActiveD1::SchemaError) { base.where(no_column: 1) }
      assert_raise(ArgumentError) { base.order(title: :sideways) }
      assert_raise(ArgumentError) { base.limit("5") }
      assert_raise(ArgumentError) { base.offset(-1) }
      @db.result = { "n" => 2 }
      assert_equal 2, relation.count
      assert_match(/COUNT\(\*\).*FROM \(SELECT 1 /, @db.calls.last.first)
      @db.result = nil
      assert_equal false, BlogEntry.offset(3).exists?
      assert_equal ['SELECT 1 AS present FROM "blog_entries" LIMIT ? OFFSET ?', [1, 3]], @db.calls.last
    end
  end

  def test_insert_dirty_update_retry_and_destroy
    ActiveD1.with_database(@db) do
      @db.result = { "key" => +"abc", "title" => +"draft", "length" => 5 }
      record = BlogEntry.create
      assert_equal ['INSERT INTO "blog_entries" DEFAULT VALUES RETURNING *', []], @db.calls.last
      assert_equal "draft", record.title
      assert_equal true, record.save
      assert_equal 1, @db.calls.size
      record.title << "!"
      @db.result = nil
      assert_raise(ActiveD1::RecordNotFound) { record.save }
      @db.result = { "key" => "abc", "title" => "draft!", "length" => 6 }
      assert_equal true, record.save
      assert_equal ['UPDATE "blog_entries" SET "title" = ? WHERE "key" = ? RETURNING *', ["draft!", "abc"]], @db.calls.last
      assert_raise(ActiveD1::SchemaError) { record.key = "xyz" }
      @db.result = 1
      record.destroy
      assert_raise(ActiveD1::RecordNotFound) { record.save }
      assert_raise(ActiveD1::RecordNotFound) { record.destroy }
    end
  end

  def test_bound_raw_sql_and_nested_request_scopes
    ActiveD1.with_database(@db) do
      @db.result = [{ "title" => "read only" }]
      row = BlogEntry.query("SELECT title FROM blog_entries WHERE key = ?", ["abc"]).first
      assert_equal "read only", row.title
      assert_raise(ActiveD1::RecordNotFound) { row.update(title: "missing primary key") }
      assert_raise(RuntimeError) { ActiveD1.with_database(nil) { BlogEntry.count } }
      @db.result = []
      assert_nil BlogEntry.limit(0).first
      assert_equal [0], @db.calls.last.last
      assert_raise(ActiveD1::RecordNotFound) { BlogEntry.find("missing") }
      assert_raise(ActiveD1::RecordNotFound) { BlogEntry.find(nil) }
    end
    assert_raise(RuntimeError) { BlogEntry.all }
  end
end
