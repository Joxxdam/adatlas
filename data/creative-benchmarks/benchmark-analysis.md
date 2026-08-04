# AdAtlas desired-quality benchmark analysis

## Scope

- Source: `data/creative-benchmarks/desired-quality`
- Analyzed files: 19
- Categories represented: personal care (11), meat/food commerce (8)
- Role: visual quality and composition benchmark only. These files are not copied into user reference labels or runtime advertiser data.

## Global quality patterns

1. The hook is understood within roughly two seconds. One headline dominates; supporting copy is subordinate.
2. The product or food scene occupies about 45-70% of the canvas. Products are never tiny decorations.
3. Text, product and price use separate contrast zones. A scrim, clean wall, card or horizontal strip creates readability.
4. Price is a grouped conversion block. Weight, original price, sale price and event badge do not drift into unrelated regions.
5. Category-specific scenes carry meaning. Personal care uses water, shower, exercise and clean product stages; meat uses grill, table and farm-trust scenes.
6. Real products remain real layers. Atmosphere and context can be generated, while labels, packaging and food identity stay sourced from the product page.
7. Graphic density is intentional: one giant hook, one proof system and one conversion area. Decorative arrows or chips only support that route.

## Personal-care patterns

- Cooling ads use cyan/teal energy, water depth and a large quiet product opening rather than applying the same ice effect to every SKU.
- Problem-solution layouts put the customer situation on one side and the real product on the other.
- Community/review layouts organize dense copy inside cards and chips, avoiding a wall of floating text.
- Repeated-product layouts create density through rhythm while the center item remains brightest.
- Clean commerce layouts can use a white field, but need scale, a color halo, a strong headline and a decisive footer.

## Food and meat patterns

- Appetite comes from large, realistic food photography and warm directional light; red saturation is controlled.
- Raw and cooked imagery can form a split story, but generated food must not be mistaken for the sold product.
- Black, white, red and yellow establish an immediate performance hierarchy.
- Price, weight and original price are treated as one block near the lower third or footer.
- Farm/process scenes function as trust evidence. Origin, grade and producer details must come from product facts.

## Implementation thresholds

- 1200x1200 only.
- Headline: one or two lines.
- Product area: target 45-70%; warn below 42%.
- At most two primary focal points.
- Text readability target: 82/100 or higher.
- Scene relevance target: 76/100 or higher.
- Overall preflight target: 78/100 or higher.

## Non-copying rule

The system may reuse information hierarchy, safe-zone planning, product scale, contrast strategy and component patterns. It must not reproduce benchmark copy, logos, exact layouts, product claims or visual identity.
