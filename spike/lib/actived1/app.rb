class Post < ActiveD1::Base
end

class PostsApp < Sinatra::Base
  def self.call(env)
    ActiveD1.with_database(env["cloudflare.env"].DB) { super(env) }
  end

  before do
    content_type "application/json"
  end

  get "/posts" do
    JSON.generate(Post.order(id: :desc).limit(20).all.map { |post| post.attributes })
  end

  get "/posts/:id" do
    JSON.generate(Post.find(params[:id]).attributes)
  end

  post "/posts" do
    payload = JSON.parse(request.body.read)
    post = Post.create(title: payload.fetch("title"), body: payload["body"])
    status 201
    JSON.generate(post.attributes)
  end

  patch "/posts/:id" do
    post = Post.find(params[:id])
    post.title = JSON.parse(request.body.read).fetch("title")
    post.save
    JSON.generate(post.attributes)
  end

  delete "/posts/:id" do
    Post.find(params[:id]).destroy
    status 204
    ""
  end

  error ActiveD1::RecordNotFound do
    status 404
    JSON.generate("error" => "post not found")
  end
end

Rackup::Handler::CloudflareWorker.run(PostsApp)
