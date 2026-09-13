class SessionApp
  def self.call(env)
    session = env["rack.session"]
    session["visits"] = session.fetch("visits", 0) + 1

    [200, { "content-type" => "text/plain; charset=utf-8" }, [
      "visits=#{session['visits']}",
    ]]
  end
end

app = Rack::Session::CookieSimple.new(
  SessionApp,
  secret: ENV.fetch("SESSION_SECRET"),
  secure: false,
  same_site: :lax,
)

Rackup::Handler::CloudflareWorker.run(app)
