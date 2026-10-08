import json
import math
import subprocess
import unittest

from backend.site import feasibility, cost_estimate, utilization
from backend.workspace import Site, Costs


def oracle(entries):
    return json.loads(subprocess.run(["node", r"tests\native-site-reference.cjs"],
        input=json.dumps(entries), text=True, capture_output=True, check=True).stdout)


class ExpandedSiteTests(unittest.TestCase):
    def site(self, **updates):
        return Site.model_validate({"width": 60, "depth": 50, "height_m": 35, "floor_height_m": 3,
            "roads": {"N": 24, "E": None, "S": None, "W": None}, **updates})

    def costs(self, **updates):
        return Costs.model_validate({"estimate_scope": "legacy-schedule", "land_inr_m2": 50000/.83612736,
            "land_sro_inr_m2": 3000/.83612736, "construction_inr_m2": 2200/.09290304,
            "stilt_inr_m2": 1210/.09290304, "flat_sro_inr_m2": 2500/.09290304,
            "registration_percent": 7.6, "gst_percent": 18, "lrs_mode": "na", "brs_mode": "na",
            "lrs_rebate": False, "brs_violated_m2": 100, **updates})

    def compare(self, actual, expected):
        for key, value in expected.items():
            if isinstance(value, dict):
                self.compare(actual[key], value)
            elif isinstance(value, (int, float)):
                self.assertTrue(math.isclose(actual[key], value, rel_tol=1e-10, abs_tol=1e-6), (key, actual[key], value))
            else:
                self.assertEqual(actual[key], value)

    def test_high_rise_tdr_custom_and_compounding_geometry_parity(self):
        sites = []
        for height, road in ((21,12),(24,12),(27,18),(30,18),(35,24),(40,24),(45,24),(50,30),(55,30)):
            for tdr in (False, True):
                for face in ("N","E","S","W"):
                    for custom in (False, True):
                        sites.append(self.site(height_m=height, tdr=tdr, facing=face,
                            roads={edge: road if edge == face else None for edge in "NESW"},
                            custom_setbacks=custom, setback_front_m=1, setback_rear_m=2,
                            setback_left_m=3, setback_right_m=4))
        sites += [self.site(width=30,depth=30,height_m=20,tdr=True),
                  self.site(width=20,depth=17.5,height_m=12,compounding=True)]
        references = oracle([site.model_dump() for site in sites])
        for site, expected in zip(sites,references):
            actual = feasibility(site)
            self.assertEqual(actual["status"], "computed", actual)
            self.compare(actual,expected)
        self.assertEqual(feasibility(self.site(width=20,depth=20,height_m=21))["status"], "prerequisites")

    def test_full_fee_parity_bands_brs_subsumption_and_cess(self):
        pairs = []
        for width,depth,height,road in ((10,10,10,9),(12,18,10,12),(20,20,12,12),(25,25,15,12),(60,50,35,24)):
            for use in ("res","apt","com"):
                for mode in ("na","paid","dev","unauth"):
                    for sro in (3000,3000.01,5000,10000,20000,30000,50000,50000.01):
                        site = self.site(width=width,depth=depth,height_m=height,use=use,
                            roads=dict(N=road,E=None,S=None,W=None),stilt=True,compounding=True)
                        costs = self.costs(lrs_mode="due",lrs_rebate=True,brs_mode=mode,
                                          land_sro_inr_m2=sro/.83612736,stilt_rate_mode="legacy-55-percent")
                        pairs.append((site,costs))
        references=oracle([{"site":site.model_dump(),"costs":costs.model_dump()} for site,costs in pairs])
        for (site,costs),expected in zip(pairs,references):
            actual=cost_estimate(site,costs)
            self.assertEqual(actual["status"],"computed",actual)
            self.compare(actual,expected["cost"])
        site=self.site(width=12,depth=18,height_m=10)
        for amount in (5000000,5000001):
            costs=self.costs(construction_inr_m2=amount/feasibility(site)["built_up_m2"])
            result=cost_estimate(site,costs)
            self.assertAlmostEqual(result["lines_inr"]["Labour cess"],0 if amount==5000000 else amount*.01,places=6)

    def test_split_and_sensitivity_parity_and_immutability(self):
        for road in (6,12,24):
            site=self.site(width=30,depth=40,height_m=12 if road==6 else 18,
                roads=dict(N=road,E=None,S=None,W=None),split_edge="N",split_fraction=.4,
                tdr=True,compounding=True,floors=3)
            costs=self.costs(lrs_mode="due",lrs_rebate=False)
            before=site.model_dump()
            result=utilization(site,costs)
            samples=[{"area":p["sample_area_m2"],"aspect":series["aspect"]}
                     for series in result["series"] for p in series["samples"]]
            reference=oracle([{"site":before,"costs":costs.model_dump(),"samples":samples}])[0]
            split=result["split"]
            self.compare({"best_fraction":split["best_sampled"]["fraction"],
                "best_usable":split["best_sampled"]["usable_m2"],"best_built":split["best_sampled"]["built_up_m2"],
                "selected_usable":split["selected"]["usable_m2"],"selected_built":split["selected"]["built_up_m2"]},reference["split"])
            actual_samples=[p for series in result["series"] for p in series["samples"]]
            for actual,expected in zip(actual_samples,reference["samples"]):
                self.compare({"lost":actual["lost_percent"],"built":actual["built_up_m2"],
                    "index":actual["built_up_per_net_m2"],"costPsf":actual["inr_per_built_ft2"] or 0,
                    "floors":actual["floors"],"h":actual["height_m"]},expected)
            self.assertEqual(site.model_dump(),before)

    def test_unknown_applicability_and_opt_in_scope(self):
        site=self.site()
        self.assertEqual(cost_estimate(site,self.costs(lrs_mode=None))["status"],"prerequisites")
        self.assertEqual(cost_estimate(site,self.costs(lrs_mode="due",lrs_rebate=None))["status"],"prerequisites")
        self.assertEqual(cost_estimate(site,self.costs(brs_mode="dev",brs_violated_m2=None))["status"],"prerequisites")
        self.assertNotIn("LRS regularisation",cost_estimate(site,self.costs(estimate_scope="partial"))["lines_inr"])

    def test_cost_breakdown_treatments_onward_exclusion_and_zero(self):
        site = self.site(stilt=False, custom_setbacks=True, setback_front_m=1,
                         setback_rear_m=1, setback_left_m=1, setback_right_m=1)
        costs = self.costs(brs_mode="dev", lrs_mode="paid", flat_sro_inr_m2=100)
        result = cost_estimate(site, costs)
        lines = {line["label"]: line for line in result["line_items"]}
        self.assertEqual(lines["LRS regularisation"]["state"], "already-paid")
        self.assertEqual(lines["Stilt"]["state"], "not-selected")
        self.assertEqual(lines["Betterment (included in BRS when due)"]["state"], "included-in-BRS")
        self.assertEqual(lines["Betterment (included in BRS when due)"]["amount_inr"], 0)
        self.assertEqual(sum(line["amount_inr"] for line in lines.values()), result["subtotal_inr"])
        self.assertTrue(all(line["basis"] for line in lines.values()))
        self.assertTrue(result["non_compliant"])
        no_onward = cost_estimate(site, costs.model_copy(update={"flat_sro_inr_m2": None}))
        self.assertEqual(no_onward["subtotal_inr"], result["subtotal_inr"])
        self.assertIsNone(no_onward["onward_sale_sro_inr"])
        zero = cost_estimate(site, self.costs(estimate_scope="partial", land_inr_m2=0,
                             construction_inr_m2=0, land_sro_inr_m2=0, registration_percent=0, gst_percent=0))
        self.assertEqual(zero["subtotal_inr"], 0)
        self.assertEqual(zero["inr_per_built_ft2"], 0)

    def test_split_diagram_dimensions_and_custom_flags(self):
        for edge in "NESW":
            site = self.site(width=30, depth=40, height_m=12, facing=edge,
                roads={key: 6 if key == edge else None for key in "NESW"},
                split_edge=edge, split_fraction=.4, custom_setbacks=True,
                setback_front_m=.5, setback_rear_m=.5, setback_left_m=.5, setback_right_m=.5)
            result = utilization(site, Costs())
            split = result["split"]
            self.assertEqual(split["sample_count"], 281)
            expected_frontage = 30 if edge in "NS" else 40
            self.assertAlmostEqual(split["selected"]["a"]["frontage_m"] + split["selected"]["b"]["frontage_m"], expected_frontage)
            for plot in (split["whole"], split["selected"]["a"], split["selected"]["b"]):
                self.assertEqual(plot["widening_m"], 1.5)
                self.assertEqual(plot["envelope"]["y"], 2)
                self.assertAlmostEqual(plot["envelope"]["width"], plot["frontage_m"] - 1)
                self.assertTrue(plot["non_compliant"])
            self.assertTrue(result["non_compliant"])
            self.assertEqual(len(result["series"]), 9)
            self.assertTrue(all(len(series["samples"]) == 91 for series in result["series"]))
            self.assertTrue(all(sample["inr_per_built_ft2"] is None for series in result["series"] for sample in series["samples"]))


if __name__ == "__main__":
    unittest.main()
