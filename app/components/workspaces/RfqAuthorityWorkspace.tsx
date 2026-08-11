export function RfqAuthorityWorkspace() {
  return (
    <section className="panel-stack" aria-labelledby="rfq-authority-title">
      <div className="panel-heading">
        <div>
          <small>Commercial authority</small>
          <h1 id="rfq-authority-title">Supplier RFQs</h1>
          <p>RFQ records are not available as authoritative MVP records yet.</p>
        </div>
      </div>
      <div className="error-state" role="status">
        <strong>Browser RFQ drafts are disabled</strong>
        <p>
          Local packages, responses, comparisons, and awards cannot create a
          pricing source or affect quotation totals. Use governed server price
          evidence until durable RFQ persistence is implemented.
        </p>
      </div>
    </section>
  );
}
