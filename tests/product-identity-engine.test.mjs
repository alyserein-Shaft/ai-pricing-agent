import test from "node:test";import assert from "node:assert/strict";import {buildProductIdentityAnalysis} from "../app/domain/product-identity-engine.mjs";
const fact=(id,file,type,value,attributes={},source={})=>({id,knowledge_file_id:file,file_name:`${file}.xlsx`,detected_type:"Price List",fact_type:type,original_value:value,normalized_value:String(value).toLowerCase(),attributes:JSON.stringify(attributes),source_location:JSON.stringify(source),confidence:96});
test("groups only exact manufacturer and product-code observations",async()=>{const facts=[fact("p1","f1","Part Number","B501-BL",{observationKey:"o1",manufacturer:"Honeywell",description:"Detector base"},{sheet:"Price",row:4,cell:"A4"}),fact("d1","f1","Product Description","Detector base",{observationKey:"o1",partNumber:"B501-BL"}),fact("p2","f2","Part Number","B501-BL",{observationKey:"o2",manufacturer:"Honeywell",description:"Detector base"},{sheet:"Catalogue",row:8,cell:"C8"}),fact("p3","f2","Part Number","B501-BL.",{observationKey:"o3",manufacturer:"Honeywell",description:"Detector base"}),fact("price","f1","Price","USD 12",{observationKey:"o1",partNumber:"B501-BL",amount:12,currency:"USD",priceType:"Historical Catalogue Price",costingEligible:false})];const result=await buildProductIdentityAnalysis({facts});assert.equal(result.identityCount,2);const identity=result.identities.find(row=>row.officialProductCode==="B501-BL");assert.equal(identity.sourceCount,2);assert.equal(identity.prices.length,1);assert.equal(identity.prices[0].costingEligible,false);assert.equal(identity.reviewStatus,"Needs Review");assert.ok(result.identities.some(row=>row.officialProductCode==="B501-BL."));});
test("isolates unknown-manufacturer codes by source and never merges by description",async()=>{const facts=[fact("a","f1","Part Number","REL-4.7K",{observationKey:"a",description:"Relay resistor"}),fact("b","f2","Part Number","REL-4.7K",{observationKey:"b",description:"Relay resistor"}),fact("c","f1","Part Number","REL-47K",{observationKey:"c",description:"Relay resistor"})];const result=await buildProductIdentityAnalysis({facts});assert.equal(result.identityCount,3);assert.ok(result.identities.every(row=>row.blockers.includes("Manufacturer is not explicitly established for this observation set.")));});
test("analysis is deterministic for unchanged observations",async()=>{const facts=[fact("p1","f1","Part Number","IFP-75HV",{observationKey:"o1",manufacturer:"Farenhyt"},{sheet:"Price",row:4,cell:"A4"})];const a=await buildProductIdentityAnalysis({facts}),b=await buildProductIdentityAnalysis({facts});assert.equal(a.inputFingerprint,b.inputFingerprint);assert.equal(a.identities[0].identityKeyFingerprint,b.identities[0].identityKeyFingerprint);});

test("supplier quotation prices become discovery-only identity memory", async () => {
  const facts = [
    fact(
      "part-supplier",
      "supplier-file-1",
      "Part Number",
      "UU004891568",
      {
        observationKey: "supplier-row-28",
        manufacturer: "Unknown",
        description: "CAT 6A 100 OHMS U/UTP LSZH 4 PAIR CABLE (500 M DRUM) GREEN",
        unit: "RL",
      },
      { page: 1, row: 28 },
    ),
    fact(
      "desc-supplier",
      "supplier-file-1",
      "Product Description",
      "CAT 6A 100 OHMS U/UTP LSZH 4 PAIR CABLE (500 M DRUM) GREEN",
      {
        observationKey: "supplier-row-28",
        partNumber: "UU004891568",
      },
      { page: 1, row: 28 },
    ),
    fact(
      "price-supplier",
      "supplier-file-1",
      "Price",
      "SAR 945",
      {
        observationKey: "supplier-row-28",
        partNumber: "UU004891568",
        amount: 945,
        currency: "SAR",
        priceType: "Supplier Quotation Price",
        effectiveDate: "2026-06-23",
        validity: "2026-07-03",
        discoveryStatus: "Discovery Only",
        costingEligible: false,
      },
      { page: 1, row: 28 },
    ),
  ];

  const result = await buildProductIdentityAnalysis({ facts });
  assert.equal(result.identityCount, 1);

  const identity = result.identities[0];
  assert.equal(identity.officialProductCode, "UU004891568");
  assert.equal(identity.prices.length, 1);
  assert.equal(identity.prices[0].amount, "945");
  assert.equal(identity.prices[0].currency, "SAR");
  assert.equal(identity.prices[0].priceType, "Supplier Quotation Price");
  assert.equal(identity.prices[0].effectiveDate, "2026-06-23");
  assert.equal(identity.prices[0].validity, "2026-07-03");
  assert.equal(identity.prices[0].discoveryStatus, "Discovery Only");
  assert.equal(identity.prices[0].costingEligible, false);
  assert.equal(identity.reviewStatus, "Needs Review");
  assert.ok(
    identity.blockers.includes(
      "Manufacturer is not explicitly established for this observation set.",
    ),
  );
});

test("conflicting supplier units remain an explicit review blocker", async () => {
  const facts = [
    fact("p1","supplier-file","Part Number","UU004891568",
      {observationKey:"o1",manufacturer:"Unknown",description:"Cat6A cable",unit:"RL"},
      {page:1,row:28}),
    fact("u1","supplier-file","Unit","RL",
      {observationKey:"o1",partNumber:"UU004891568"},
      {page:1,row:28}),
    fact("p2","supplier-file","Part Number","UU004891568",
      {observationKey:"o2",manufacturer:"Unknown",description:"Cat6A cable",unit:"PCS"},
      {page:2,row:28}),
    fact("u2","supplier-file","Unit","PCS",
      {observationKey:"o2",partNumber:"UU004891568"},
      {page:2,row:28}),
  ];

  const result = await buildProductIdentityAnalysis({ facts });
  assert.equal(result.identityCount, 1);
  assert.equal(result.identities[0].unit, null);
  assert.ok(result.identities[0].blockers.includes("Unit observations conflict."));
  assert.equal(result.identities[0].reviewStatus, "Needs Review");
});
