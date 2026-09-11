"""Weakest-link verdict: META > DROP > FIX > PASS. Every contributing gate is listed.

Only hygiene produces DROP (scope §9). Notes are informational and never change
the verdict. S9 on the PINNED scaler is a FIX (the transform, not the column, is
the problem); S9 on any other scaler is a note.
"""
RANK = {"PASS": 0, "FIX": 1, "DROP": 2, "META": 3}


def decide(r):
    reasons, notes = [], []

    def hit(level, gate, why):
        reasons.append({"level": level, "gate": gate, "why": why})

    s1, s2, s3, s4, s5, s9, s13 = (r.get(k, {}) or {} for k in ("s1", "s2", "s3", "s4", "s5", "s9", "s13"))
    t = s1.get("type")
    if t == "admin":
        hit("META", "S1", "administrative column (exclusion_reason: admin); kept as a slice key")
        return {"verdict": "META", "reasons": reasons, "notes": notes, "exclusion_reason": "admin"}
    if t == "text":
        hit("META", "S1", "non-numeric column")
    if s13.get("known_exclusion"):
        hit("META", "S13", f"known exclusion ({s13.get('exclusion_reason')}): {s13['known_exclusion']}")
    if s2.get("class") == "ABSENT":
        # A column that exists only in some samples identifies the sample it came
        # from: provenance by construction (scan layer §13.2), not a dead feature.
        hit("META", "S2", "not in every file (absent from " + ", ".join(s2.get("absent_in", []))
            + "): provenance by construction")
        return {"verdict": "META", "reasons": reasons, "notes": notes,
                "exclusion_reason": "leakage_provenance"}
    if s2.get("class") == "UNUSABLE":
        hit("DROP", "S2", f"invalid fraction {s2['worst_invalid_frac']:.1%} in worst sample")
    if t == "empty" or s3.get("empty"):
        hit("DROP", "S3", "no valid values")
    elif s3.get("constant"):
        hit("DROP", "S3", f"constant (value {s3.get('top_value')})")
    elif s3.get("near_constant"):
        hit("DROP", "S3", f"near-constant: top value holds {s3['top_share']:.3%}")
    if s13.get("leak"):
        for why in s13.get("reasons", []):
            if not why.startswith("known exclusion"):
                hit("DROP", "S13", why)
    if s2.get("class") == "MASKABLE":
        hit("FIX", "S2", f"mask invalid values ({s2['worst_invalid_frac']:.1%} worst sample)")
    if s2.get("candidate_values"):
        hit("FIX", "S2", "sentinel candidates await a ruling: " +
            ", ".join(f"{v:g}" for v in s2["candidate_values"]))
    sc = (s9.get("scalers") or {})
    if s9.get("pinned_flag"):
        p = sc[s9["pinned"]]
        hit("FIX", "S9", f"pinned scaler {s9['pinned']} delivers {p['realised_frac']:.1%} of achievable "
                         f"resolution: re-transform")
    for mode, row in sc.items():
        if mode != s9.get("pinned") and row.get("flag"):
            notes.append(f"S9 {mode} would crush this column ({row['realised_frac']:.1%} of achievable)")
    if s9.get("column_limited"):
        notes.append(f"S9 column-limited: ceiling {s9['ceiling_bits']:.2f} bits, no scaler can add resolution")
    if s13.get("provenance_flag"):
        notes.append(f"S13 provenance flag: separation {s13['value_sep']:.4f} "
                     f">= {r['_settings']['s13_provenance_auc']}")
    mm = s13.get("mass_mi") or {}
    if mm.get("flag"):
        notes.append(f"S13.2 mass-point dependence: MI {mm['mi_bits']:.4f} bits, z {mm['z']:.1f} vs "
                     "permutation null (expect trouble on held-out mass)")
    if s4.get("dequant_candidate"):
        notes.append(f"S4 dequantization candidate ({s4['n_unique']} values)")
    elif s4.get("low_card"):
        notes.append(f"S4 low cardinality ({s4['n_unique']} values)")
    spikes = s5.get("spikes") or []
    if spikes:
        notes.append("S5 spike at " + ", ".join(f"{sp['value']:g} ({sp['share']:.1%}, {sp['kind']})"
                                                 for sp in spikes[:3]))
    zi = s5.get("zi") or {}
    if zi.get("zero_inflated"):
        nb = f", NB {zi['nb_p0']:.1%}" if zi.get("nb_p0") is not None else ""
        notes.append(f"S5 zero-inflated: P(0) {zi['zero_share']:.1%} vs Poisson {zi['poisson_p0']:.1%}{nb}, "
                     f"van den Broek z {zi['vdb_z']:.1f}")
    level = "PASS"
    for rr in reasons:
        if RANK[rr["level"]] > RANK[level]:
            level = rr["level"]
    return {"verdict": level, "reasons": reasons, "notes": notes,
            "exclusion_reason": s13.get("exclusion_reason") if level == "META" else None}
