"""One module per scan. Each exposes run(cv, ctx) -> dict (JSON-safe).

ctx carries results of earlier scans for the same column, so order is explicit
(canon C7): S1 -> S2 -> S3 -> S4 -> S5 -> S13 -> S6 -> S7 -> S9.
"""
from . import (s1_typing, s2_missing, s3_dead, s4_cardinality, s5_inflation, s6_stats, s7_figures,
               s9_span, s13_leakage)

ORDER = [
    ("s1", s1_typing),
    ("s2", s2_missing),
    ("s3", s3_dead),
    ("s4", s4_cardinality),
    ("s5", s5_inflation),
    ("s13", s13_leakage),
    ("s6", s6_stats),
    ("s7", s7_figures),
    ("s9", s9_span),
]

BUILT = [k for k, _ in ORDER]
NOT_BUILT = ["s8", "s10", "s11", "s12", "s14", "s15"]   # S14.5 runs as its own job (engine/crossblock.py)
