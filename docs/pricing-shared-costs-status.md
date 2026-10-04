# Pricing shared-cost status

`pricing_shared_costs` and `pricing_cost_allocations` remain schema compatibility structures only. No current worker route, pricing calculation, commercial approval, quotation snapshot, or export reads them as costing authority.

They must not be presented as active shared-cost allocation or used to manufacture a project total without a separately governed implementation. The active cost path is currently:

`pricing_lines` → `pricing_cost_components` → approved pricing line → immutable quotation line snapshot.

A future shared-cost feature must define allocation basis, scenario/version currency, evidence, approval, stale invalidation, and quotation/export snapshot semantics before any runtime consumer is added.
