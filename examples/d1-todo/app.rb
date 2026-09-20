class TodoApp < Sinatra::Base
  before do
    headers "cache-control" => "no-store"
  end

  get "/api/todos" do
    rows = database.prepare(
      "SELECT id, title, completed, created_at FROM todos ORDER BY id DESC"
    ).rows
    json_response rows.map { |row| serialize_todo(row) }
  end

  post "/api/todos" do
    payload = json_body
    title = payload["title"]
    unless title.is_a?(String) && !title.strip.empty? && title.bytesize <= 200
      halt_json 422, "title must be a non-empty String of at most 200 bytes"
    end

    result = database
      .prepare("INSERT INTO todos (title, completed) VALUES (?1, ?2)")
      .bind(title.strip, false)
      .run
    row = database
      .prepare("SELECT id, title, completed, created_at FROM todos WHERE id = ?1")
      .bind(result.last_row_id)
      .first
    status 201
    json_response serialize_todo(row)
  end

  patch "/api/todos/:id" do
    payload = json_body
    completed = payload["completed"]
    unless completed == true || completed == false
      halt_json 422, "completed must be boolean"
    end

    result = database
      .prepare("UPDATE todos SET completed = ?1 WHERE id = ?2")
      .bind(completed, todo_id)
      .run
    halt_json 404, "todo not found" if result.changes == 0

    row = database
      .prepare("SELECT id, title, completed, created_at FROM todos WHERE id = ?1")
      .bind(todo_id)
      .first
    json_response serialize_todo(row)
  end

  delete "/api/todos/:id" do
    result = database
      .prepare("DELETE FROM todos WHERE id = ?1")
      .bind(todo_id)
      .run
    halt_json 404, "todo not found" if result.changes == 0

    status 204
    ""
  end

  error Cloudflare::Error do
    status 502
    json_response("error" => "D1 request failed")
  end

  error 400 do
    json_response("error" => "bad request")
  end

  not_found do
    json_response("error" => "not found")
  end

  private

  def database
    env["cloudflare.env"].DB
  end

  def json_body
    begin
      payload = JSON.parse(env["rack.input"].read)
    rescue JSON::JSONError
      halt_json 400, "request body must be valid JSON"
    end
    halt_json 400, "request body must be a JSON object" unless payload.is_a?(Hash)
    payload
  end

  def todo_id
    id = params[:id]
    halt_json 404, "todo not found" unless id && id.match?(/\A[1-9][0-9]*\z/)
    id.to_i
  end

  def serialize_todo(row)
    {
      "id" => row[:id],
      "title" => row[:title],
      "completed" => row[:completed] == 1,
      "created_at" => row[:created_at],
    }
  end

  def json_response(payload)
    content_type "application/json", charset: "utf-8"
    JSON.generate(payload)
  end

  def halt_json(status_code, message)
    halt status_code, json_response("error" => message)
  end
end

Rackup::Handler::CloudflareWorker.run(TodoApp)
