# Phase 9 — Performance

Checked on 27 September 2026 against the [master specification](master-specification.md) §29.

| Requirement | Status | Where |
| --- | --- | --- |
| Goals, KPI, OKR | Implemented: KPI, OKR, goal and development types with a metric, target, unit, weight and due date. Goals go from draft to approval by the manager, then progress, then completed. **Added:** key results under an OKR objective. Objective progress is the weighted average of its key results and cannot be set directly. A key result must belong to the same employee's objective. | Performance → Goals |
| Review cycles | Implemented: draft, then launch (creates a review for each active employee, with the manager as reviewer), then close | Review cycles |
| Self evaluation, manager review | Implemented. The employee does not see the manager's assessment until it is completed, and acknowledges it afterwards. | Reviews |
| Peer feedback | **Added:** a cycle can include peer reviews. The manager or HR asks up to 10 colleagues; the employee cannot be one of their own peers, and the colleagues must be from the same company. Peers see their requests under "Peer reviews" and either rate and comment or decline. They cannot answer after the review is completed. Managers and HR see each named response. After completion the employee sees only the count, the average and unnamed comments. General praise and notes are still available. | Performance → Peer reviews |
| Rating | **Added:** each cycle has its own scale (3 to 10 points) with optional labels. Ratings outside the scale are refused. The manager's rating becomes the final rating. **Added:** HR can calibrate the final rating with a recorded reason. The reason is not shown to the employee. | cycle settings; review → Calibrate |
| Comments | Implemented: self, manager, strengths, areas to improve, development plan, feedback | Reviews |
| History | **Added:** per employee and cycle: self, manager, peer-average and final ratings, whether the rating was calibrated, and goals completed. It follows the same visibility rules as reviews. | Performance → History |
| AI assistance | AI KPI/OKR suggestions arrive as draft goals that the manager edits and approves. Review drafting and development-plan suggestions are covered in Phase 12. | HR Copilot |

**Verification:** `tests/integration/performance.test.ts` has 4 tests. They cover:
- scale and label validation, and ratings outside the scale;
- peer requests: permissions, self-exclusion and tenant checks;
- a peer answering once, declining, and answering after completion;
- the named view for managers and the unnamed summary for the employee;
- calibration permission and visibility;
- history, including cross-tenant and colleague access;
- the key-result roll-up and ownership checks.

A cross-tenant history request returned an empty list instead of "not found"; that is now fixed.
