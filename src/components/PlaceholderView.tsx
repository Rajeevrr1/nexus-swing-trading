export function PlaceholderView({ title, message }: { title: string; message: string }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h1>{title}</h1>
          <p className="lede">{message}</p>
        </div>
      </div>
      <div className="placeholder-card">
        <p>Nothing to scan on this screen yet.</p>
      </div>
    </section>
  );
}
