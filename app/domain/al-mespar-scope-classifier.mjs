const DIVISIONS = {
  "03": { discipline: "Structural", category: "Concrete" },
  "04": { discipline: "Architectural", category: "Masonry" },
  "05": { discipline: "Structural", category: "Metals" },
  "07": { discipline: "Architectural", category: "Thermal and Moisture Protection" },
  "08": { discipline: "Architectural", category: "Openings and Facade" },
  "09": { discipline: "Architectural", category: "Finishes" },
  "10": { discipline: "Architectural", category: "Specialties" },
  "11": { discipline: "Specialist Equipment", category: "Facade Access Equipment" },
  "14": { discipline: "Vertical Transportation", category: "Elevators" },
};

export const classifyAlMesparScope = (item) => {
  const division = String(item?.item_number || item?.itemNumber || "").split("-")[0];
  const classification = DIVISIONS[division] || { discipline: "Unclassified", category: "Needs Review" };
  return {
    ...classification,
    division,
    inAlMesparScope: false,
    reason: division === "11"
      ? "Specialist facade-access equipment is outside the defined Al Mespar estimating systems."
      : `${classification.discipline} work is outside the defined Al Mespar estimating systems.`,
  };
};

