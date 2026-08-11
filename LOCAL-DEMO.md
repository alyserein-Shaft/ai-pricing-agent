# AI Pricing Agent — Local Demo

This repository contains an interactive local prototype for the pricing workflow.

## Run locally

Requirements:

- Node.js 22.13 or newer
- npm

Commands:

```bash
npm install
npm run dev -- --host 0.0.0.0
```

Open the local address printed in the terminal.

## Demo test flow

1. Change a unit cost or markup and confirm the totals update.
2. Resolve the Data Cables link alert.
3. Resolve the exchange-rate alert.
4. Generate the client quotation.
5. Change VAT, warranty, or validity in Settings and confirm the quotation updates.
6. Export the Cost Sheet CSV.
7. Refresh the page and confirm local edits remain.
8. Use **Reset Demo** to restore the original sample.

## Current demo boundary

The sample project and pricing calculations are interactive. Uploaded file names
are captured locally for workflow testing, but automatic Excel/PDF extraction is
not connected yet. That parser and the AI matching engine belong to the next
implementation phase.
