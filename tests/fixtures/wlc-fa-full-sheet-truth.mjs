// Independent full-sheet Fire Alarm ground truth: WLC-T-93-ZZZ-005 p1.
// Built deterministically from PDF bytes (text census + vector inventory) and
// T-00 approved legend rows. NEVER derived from recognition predictions.
// Truth regions follow the frozen five-truth convention (member union + pad 12).
// Statuses: VERIFIED (class certain) | AMBIGUOUS (placement certain, class
// underdetermined) | VERIFIED-UNCLASSIFIABLE (no legend row governs the class).
export const WLC_FA_TRUTH_SET = {
  "benchmark": {
    "project": "Al Mousa School \\u2014 Clean Golden Run",
    "document": "2401232-PC-WLC-DR-T-93-ZZZ-005.pdf",
    "documentId": "doc_3a7c645e-08b2-49b0-822c-3036a0da439f",
    "shaPrefix": "e0f2c3975f90adcd",
    "page": 1,
    "legendSource": "T-00",
    "frozen": "2026-09-24"
  },
  "truths": [
    {
      "truth_id": "WLC-FA-01",
      "page": 1,
      "class": "CE M",
      "abbreviation": "CE M",
      "bbox": {
        "x": 1571.04,
        "y": 1041.48,
        "width": 33.93,
        "height": 43.16
      },
      "memberTags": [
        {
          "text": "CE",
          "x": 1583.04,
          "y": 1053.48
        },
        {
          "text": "M",
          "x": 1587.96,
          "y": 1064.64
        }
      ],
      "evidence": "pdf-text:CE+M@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-02",
      "page": 1,
      "class": "CE M",
      "abbreviation": "CE M",
      "bbox": {
        "x": 1323,
        "y": 956.52,
        "width": 36.59,
        "height": 43.04
      },
      "memberTags": [
        {
          "text": "CE",
          "x": 1335,
          "y": 968.52
        },
        {
          "text": "M",
          "x": 1342.56,
          "y": 979.56
        }
      ],
      "evidence": "pdf-text:CE+M@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-03",
      "page": 1,
      "class": "CE M",
      "abbreviation": "CE M",
      "bbox": {
        "x": 1201.92,
        "y": 957.96,
        "width": 36.71,
        "height": 43.04
      },
      "memberTags": [
        {
          "text": "CE",
          "x": 1213.92,
          "y": 969.96
        },
        {
          "text": "M",
          "x": 1221.6,
          "y": 981
        }
      ],
      "evidence": "pdf-text:CE+M@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-04",
      "page": 1,
      "class": "CE M",
      "abbreviation": "CE M",
      "bbox": {
        "x": 1571.04,
        "y": 1002.48,
        "width": 33.95,
        "height": 43.16
      },
      "memberTags": [
        {
          "text": "CE",
          "x": 1583.04,
          "y": 1014.48
        },
        {
          "text": "M",
          "x": 1587.96,
          "y": 1025.64
        }
      ],
      "evidence": "pdf-text:CE+M@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-05",
      "page": 1,
      "class": "CE M",
      "abbreviation": "CE M",
      "bbox": {
        "x": 1323,
        "y": 917.52,
        "width": 33.96,
        "height": 43.04
      },
      "memberTags": [
        {
          "text": "CE",
          "x": 1335,
          "y": 929.52
        },
        {
          "text": "M",
          "x": 1339.92,
          "y": 940.56
        }
      ],
      "evidence": "pdf-text:CE+M@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-06",
      "page": 1,
      "class": "CE M",
      "abbreviation": "CE M",
      "bbox": {
        "x": 1201.92,
        "y": 917.52,
        "width": 34.08,
        "height": 43.04
      },
      "memberTags": [
        {
          "text": "CE",
          "x": 1213.92,
          "y": 929.52
        },
        {
          "text": "M",
          "x": 1218.96,
          "y": 940.56
        }
      ],
      "evidence": "pdf-text:CE+M@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-07",
      "page": 1,
      "class": "CE C",
      "abbreviation": "CE C",
      "bbox": {
        "x": 1201.92,
        "y": 997.44,
        "width": 36.04,
        "height": 43.4
      },
      "memberTags": [
        {
          "text": "CE",
          "x": 1213.92,
          "y": 1009.44
        },
        {
          "text": "C",
          "x": 1221.6,
          "y": 1020.84
        }
      ],
      "evidence": "pdf-text:CE+C@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-08",
      "page": 1,
      "class": "S D",
      "abbreviation": "S D",
      "bbox": {
        "x": 1201.92,
        "y": 1048.44,
        "width": 36.04,
        "height": 41.12
      },
      "memberTags": [
        {
          "text": "S",
          "x": 1213.92,
          "y": 1060.44
        },
        {
          "text": "D",
          "x": 1221.6,
          "y": 1069.56
        }
      ],
      "evidence": "pdf-text:S+D@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-09",
      "page": 1,
      "class": "H",
      "abbreviation": "H",
      "bbox": {
        "x": 1324.8,
        "y": 1076.64,
        "width": 28.37,
        "height": 32
      },
      "memberTags": [
        {
          "text": "H",
          "x": 1336.8,
          "y": 1088.64
        }
      ],
      "evidence": "pdf-text:H@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-10",
      "page": 1,
      "class": "H",
      "abbreviation": "H",
      "bbox": {
        "x": 1572.84,
        "y": 1122.72,
        "width": 28.37,
        "height": 32
      },
      "memberTags": [
        {
          "text": "H",
          "x": 1584.84,
          "y": 1134.72
        }
      ],
      "evidence": "pdf-text:H@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-11",
      "page": 1,
      "class": "H",
      "abbreviation": "H",
      "bbox": {
        "x": 1328.16,
        "y": 1131.48,
        "width": 28.35,
        "height": 32
      },
      "memberTags": [
        {
          "text": "H",
          "x": 1340.16,
          "y": 1143.48
        }
      ],
      "evidence": "pdf-text:H@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-12",
      "page": 1,
      "class": "T",
      "abbreviation": "T",
      "bbox": {
        "x": 1394.04,
        "y": 2102.28,
        "width": 27.69,
        "height": 32
      },
      "memberTags": [
        {
          "text": "T",
          "x": 1406.04,
          "y": 2114.28
        }
      ],
      "evidence": "pdf-text:T@tap;zone=stairs-D",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-13",
      "page": 1,
      "class": "T",
      "abbreviation": "T",
      "bbox": {
        "x": 1303.2,
        "y": 2102.28,
        "width": 27.69,
        "height": 32
      },
      "memberTags": [
        {
          "text": "T",
          "x": 1315.2,
          "y": 2114.28
        }
      ],
      "evidence": "pdf-text:T@tap;zone=stairs-D",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-14",
      "page": 1,
      "class": "T",
      "abbreviation": "T",
      "bbox": {
        "x": 1191.6,
        "y": 2102.28,
        "width": 27.69,
        "height": 32
      },
      "memberTags": [
        {
          "text": "T",
          "x": 1203.6,
          "y": 2114.28
        }
      ],
      "evidence": "pdf-text:T@tap;zone=stairs-D",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-15",
      "page": 1,
      "class": "T",
      "abbreviation": "T",
      "bbox": {
        "x": 1394.04,
        "y": 2178.48,
        "width": 27.69,
        "height": 32
      },
      "memberTags": [
        {
          "text": "T",
          "x": 1406.04,
          "y": 2190.48
        }
      ],
      "evidence": "pdf-text:T@tap;zone=stairs-D",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-16",
      "page": 1,
      "class": "T",
      "abbreviation": "T",
      "bbox": {
        "x": 1303.2,
        "y": 2178.48,
        "width": 27.69,
        "height": 32
      },
      "memberTags": [
        {
          "text": "T",
          "x": 1315.2,
          "y": 2190.48
        }
      ],
      "evidence": "pdf-text:T@tap;zone=stairs-D",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-17",
      "page": 1,
      "class": "T",
      "abbreviation": "T",
      "bbox": {
        "x": 1191.6,
        "y": 2178.48,
        "width": 27.69,
        "height": 32
      },
      "memberTags": [
        {
          "text": "T",
          "x": 1203.6,
          "y": 2190.48
        }
      ],
      "evidence": "pdf-text:T@tap;zone=stairs-D",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-18",
      "page": 1,
      "class": "F",
      "abbreviation": "F",
      "bbox": {
        "x": 1572.84,
        "y": 1084.68,
        "width": 27.73,
        "height": 32
      },
      "memberTags": [
        {
          "text": "F",
          "x": 1584.84,
          "y": 1096.68
        }
      ],
      "evidence": "pdf-text:F@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-19",
      "page": 1,
      "class": "F",
      "abbreviation": "F",
      "bbox": {
        "x": 1324.8,
        "y": 1000.44,
        "width": 27.7,
        "height": 32
      },
      "memberTags": [
        {
          "text": "F",
          "x": 1336.8,
          "y": 1012.44
        }
      ],
      "evidence": "pdf-text:F@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-20",
      "page": 1,
      "class": "F",
      "abbreviation": "F",
      "bbox": {
        "x": 1203.72,
        "y": 1128.24,
        "width": 27.7,
        "height": 32
      },
      "memberTags": [
        {
          "text": "F",
          "x": 1215.72,
          "y": 1140.24
        }
      ],
      "evidence": "pdf-text:F@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-21",
      "page": 1,
      "class": "F",
      "abbreviation": "F",
      "bbox": {
        "x": 1206.6,
        "y": 1087.2,
        "width": 27.7,
        "height": 32
      },
      "memberTags": [
        {
          "text": "F",
          "x": 1218.6,
          "y": 1099.2
        }
      ],
      "evidence": "pdf-text:F@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-22",
      "page": 1,
      "class": "S",
      "abbreviation": "S",
      "bbox": {
        "x": 1572.84,
        "y": 1202.52,
        "width": 28.01,
        "height": 32
      },
      "memberTags": [
        {
          "text": "S",
          "x": 1584.84,
          "y": 1214.52
        }
      ],
      "evidence": "pdf-text:S@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-23",
      "page": 1,
      "class": "S",
      "abbreviation": "S",
      "bbox": {
        "x": 1324.8,
        "y": 1165.32,
        "width": 28.03,
        "height": 32
      },
      "memberTags": [
        {
          "text": "S",
          "x": 1336.8,
          "y": 1177.32
        }
      ],
      "evidence": "pdf-text:S@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-24",
      "page": 1,
      "class": "S",
      "abbreviation": "S",
      "bbox": {
        "x": 1201.92,
        "y": 1165.32,
        "width": 28.03,
        "height": 32
      },
      "memberTags": [
        {
          "text": "S",
          "x": 1213.92,
          "y": 1177.32
        }
      ],
      "evidence": "pdf-text:S@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-25",
      "page": 1,
      "class": "S",
      "abbreviation": "S",
      "bbox": {
        "x": 1324.8,
        "y": 1121.16,
        "width": 28.03,
        "height": 32
      },
      "memberTags": [
        {
          "text": "S",
          "x": 1336.8,
          "y": 1133.16
        }
      ],
      "evidence": "pdf-text:S@tap;zone=riser-A",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-26",
      "page": 1,
      "class": "S+C?",
      "abbreviation": null,
      "bbox": {
        "x": 1573.2,
        "y": 1162.44,
        "width": null,
        "height": null
      },
      "memberTags": [
        {
          "text": "S",
          "x": 1585.2,
          "y": 1174.44
        },
        {
          "text": "C",
          "x": 1585.2,
          "y": 1185
        }
      ],
      "evidence": "pdf-text:S@tap;zone=riser-A;merged-shared-outline",
      "verification": "AMBIGUOUS",
      "note": "one square tap, C+S tags, no legend row; S main certain, C meaning unverified (visually verified shared outline)"
    },
    {
      "truth_id": "WLC-FA-27",
      "page": 1,
      "class": "S+C?",
      "abbreviation": null,
      "bbox": {
        "x": 1325.16,
        "y": 1039.32,
        "width": null,
        "height": null
      },
      "memberTags": [
        {
          "text": "S",
          "x": 1337.16,
          "y": 1051.32
        },
        {
          "text": "C",
          "x": 1344.72,
          "y": 1060.68
        }
      ],
      "evidence": "pdf-text:S@tap;zone=riser-A;merged-shared-outline",
      "verification": "AMBIGUOUS",
      "note": "one square tap, C+S tags, no legend row; S main certain, C meaning unverified (visually verified shared outline)"
    },
    {
      "truth_id": "WLC-FA-28",
      "page": 1,
      "class": "WP",
      "abbreviation": "WP",
      "bbox": {
        "x": 1478.52,
        "y": 1795.92,
        "width": 37.89,
        "height": 32
      },
      "memberTags": [
        {
          "text": "WP",
          "x": 1490.52,
          "y": 1807.92
        }
      ],
      "evidence": "pdf-text:WP@tap;zone=drops-C",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-29",
      "page": 1,
      "class": "WP",
      "abbreviation": "WP",
      "bbox": {
        "x": 1407.6,
        "y": 1795.92,
        "width": 37.89,
        "height": 32
      },
      "memberTags": [
        {
          "text": "WP",
          "x": 1419.6,
          "y": 1807.92
        }
      ],
      "evidence": "pdf-text:WP@tap;zone=drops-C",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-30",
      "page": 1,
      "class": "WP",
      "abbreviation": "WP",
      "bbox": {
        "x": 1180.2,
        "y": 1760.64,
        "width": 37.89,
        "height": 32
      },
      "memberTags": [
        {
          "text": "WP",
          "x": 1192.2,
          "y": 1772.64
        }
      ],
      "evidence": "pdf-text:WP@tap;zone=drops-C",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-31",
      "page": 1,
      "class": "WP",
      "abbreviation": "WP",
      "bbox": {
        "x": 1297.8,
        "y": 1760.64,
        "width": 37.89,
        "height": 32
      },
      "memberTags": [
        {
          "text": "WP",
          "x": 1309.8,
          "y": 1772.64
        }
      ],
      "evidence": "pdf-text:WP@tap;zone=drops-C",
      "verification": "VERIFIED",
      "note": "frozen-rule chain accepted"
    },
    {
      "truth_id": "WLC-FA-32",
      "page": 1,
      "class": "SM",
      "abbreviation": null,
      "bbox": {
        "x": 1506.12,
        "y": 1666.92,
        "width": 33.09,
        "height": 32
      },
      "memberTags": [
        {
          "text": "SM",
          "x": 1518.12,
          "y": 1678.92
        }
      ],
      "evidence": "pdf-text:SM@tap;zone=drops-C",
      "verification": "VERIFIED-UNCLASSIFIABLE",
      "note": "placement certain; no T-00 legend row governs SM"
    },
    {
      "truth_id": "WLC-FA-33",
      "page": 1,
      "class": "SM",
      "abbreviation": null,
      "bbox": {
        "x": 1435.32,
        "y": 1666.92,
        "width": 33.1,
        "height": 32
      },
      "memberTags": [
        {
          "text": "SM",
          "x": 1447.32,
          "y": 1678.92
        }
      ],
      "evidence": "pdf-text:SM@tap;zone=drops-C",
      "verification": "VERIFIED-UNCLASSIFIABLE",
      "note": "placement certain; no T-00 legend row governs SM"
    },
    {
      "truth_id": "WLC-FA-34",
      "page": 1,
      "class": "SM",
      "abbreviation": null,
      "bbox": {
        "x": 1325.4,
        "y": 1666.92,
        "width": 33.1,
        "height": 32
      },
      "memberTags": [
        {
          "text": "SM",
          "x": 1337.4,
          "y": 1678.92
        }
      ],
      "evidence": "pdf-text:SM@tap;zone=drops-C",
      "verification": "VERIFIED-UNCLASSIFIABLE",
      "note": "placement certain; no T-00 legend row governs SM"
    },
    {
      "truth_id": "WLC-FA-37",
      "page": 1,
      "class": "CE-family?",
      "abbreviation": null,
      "bbox": {
        "x": 1603.56,
        "y": 1844.4,
        "width": 29.52,
        "height": 35.28
      },
      "memberTags": [],
      "evidence": "pdf-vector:untagged triangle drop x1615.6;interface-module note region",
      "verification": "AMBIGUOUS",
      "note": "placement certain; CE-family vs other-system (PAVA) indistinguishable without tags"
    },
    {
      "truth_id": "WLC-FA-38",
      "page": 1,
      "class": "CE-family?",
      "abbreviation": null,
      "bbox": {
        "x": 1616.76,
        "y": 1844.4,
        "width": 29.64,
        "height": 35.28
      },
      "memberTags": [],
      "evidence": "pdf-vector:untagged triangle drop x1628.8;interface-module note region",
      "verification": "AMBIGUOUS",
      "note": "placement certain; CE-family vs other-system (PAVA) indistinguishable without tags"
    },
    {
      "truth_id": "WLC-FA-39",
      "page": 1,
      "class": "CE-family?",
      "abbreviation": null,
      "bbox": {
        "x": 1630.56,
        "y": 1844.4,
        "width": 29.52,
        "height": 35.28
      },
      "memberTags": [],
      "evidence": "pdf-vector:untagged triangle drop x1642.6;interface-module note region",
      "verification": "AMBIGUOUS",
      "note": "placement certain; CE-family vs other-system (PAVA) indistinguishable without tags"
    },
    {
      "truth_id": "WLC-FA-40",
      "page": 1,
      "class": "CE-family?",
      "abbreviation": null,
      "bbox": {
        "x": 1643.4,
        "y": 1844.4,
        "width": 29.52,
        "height": 35.28
      },
      "memberTags": [],
      "evidence": "pdf-vector:untagged triangle drop x1655.4;interface-module note region",
      "verification": "AMBIGUOUS",
      "note": "placement certain; CE-family vs other-system (PAVA) indistinguishable without tags"
    },
    {
      "truth_id": "WLC-FA-41",
      "page": 1,
      "class": "CE-family?",
      "abbreviation": null,
      "bbox": {
        "x": 1654.92,
        "y": 1844.4,
        "width": 29.52,
        "height": 35.28
      },
      "memberTags": [],
      "evidence": "pdf-vector:untagged triangle drop x1666.9;interface-module note region",
      "verification": "AMBIGUOUS",
      "note": "placement certain; CE-family vs other-system (PAVA) indistinguishable without tags"
    },
    {
      "truth_id": "WLC-FA-42",
      "page": 1,
      "class": "CE-family?",
      "abbreviation": null,
      "bbox": {
        "x": 1665.96,
        "y": 1844.4,
        "width": 29.52,
        "height": 35.28
      },
      "memberTags": [],
      "evidence": "pdf-vector:untagged triangle drop x1678.0;interface-module note region",
      "verification": "AMBIGUOUS",
      "note": "placement certain; CE-family vs other-system (PAVA) indistinguishable without tags"
    },
    {
      "truth_id": "WLC-FA-43",
      "page": 1,
      "class": "CE-family?",
      "abbreviation": null,
      "bbox": {
        "x": 1677.48,
        "y": 1844.4,
        "width": 29.64,
        "height": 35.28
      },
      "memberTags": [],
      "evidence": "pdf-vector:untagged triangle drop x1689.5;interface-module note region",
      "verification": "AMBIGUOUS",
      "note": "placement certain; CE-family vs other-system (PAVA) indistinguishable without tags"
    }
  ]
};
