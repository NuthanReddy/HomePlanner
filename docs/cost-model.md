# Cost model

The cost panel is an editable feasibility model, not a quotation or tax
calculation. Rates entered by the user are more important than the example
defaults.

## Included layers

```text
total =
  gross plot purchase
  + land registration/stamp/transfer percentage
  + LRS when selected
  + legacy BRS estimate when selected
  + construction
  + stilt/parking construction
  + selected GST percentage
  + infrastructure impact fee
  + betterment charge
  + labour cess when applicable
  + Rule 26(d) compounding scenario fee
```

The headline cost per usable built-up square foot is:

```text
all-in total / usable built-up square feet
```

## Land and road widening

Land purchase and land-value charges use the gross registered plot. A mandatory
road-widening strip is then removed from usable/net plot geometry. This is why
a narrow road can reduce efficiency without reducing the assumed purchase
price.

## LRS

The LRS model follows the G.O.Ms.No.131/135 structure implemented in the app:

- Basic rate per sq m by gross plot-size band.
- Percentage multiplier by SRO land-value band.
- 14 percent of plot SRO value for open-space shortfall.
- Optional 25 percent rebate control.

The user selects whether LRS is due, already paid, or not applicable.

## BRS

The BRS panel is a legacy G.O.Ms.No.152/2015 estimate for existing eligible
work. It is not a new-construction permission route.

- User enters violated built-up area across all floors.
- Annexure-I rate depends on plot size, residential/commercial use, and
  deviation versus unauthorised status.
- Annexure-III percentage uses the SRO land-value band.
- When BRS is selected, the model avoids double-counting permit/development,
  betterment, and impact charges described as included in that charge.

Current application availability and eligibility must be confirmed with
TG-bPASS/GHMC/HMDA.

## Construction and statutory layers

- Habitable built-up uses the user-entered construction rate.
- Stilt cost defaults to 55 percent of the habitable rate when blank.
- GST is user-selectable and defaults to zero.
- Infrastructure impact fee uses G.O.Ms.No.168 Rule 21 Table VI and only floors
  above the first 15 m, excluding stilt.
- Betterment uses the public 2008 GHMC schedule in the app and is explicitly
  marked low confidence because a later public revision was not found.
- Labour cess is modelled at 1 percent for commercial work or residential
  construction above the implemented threshold.
- Rule 26(d) scenario fee values the additional side/rear violated footprint at
  100 percent of entered SRO land value.

Not included: professional fees, financing, escalation, TDR purchase price,
permit/scrutiny amounts computed by TG-bPASS, demolition, soil/structural
premiums, utilities, interiors, or project-specific taxes.

