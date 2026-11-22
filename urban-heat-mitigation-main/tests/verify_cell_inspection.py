import urllib.request
import json

cities = ['new_delhi', 'mumbai', 'bengaluru', 'chennai', 'kolkata']

print("=== 1. Cell SHAP Attribution Checks ===")
for c in cities:
    grid_url = f'http://127.0.0.1:8000/api/v1/grid?city={c}'
    with urllib.request.urlopen(grid_url) as res:
        grid = json.loads(res.read())
        first_cell = grid['features'][0]['properties']
        gid = first_cell['grid_id']
        lst = first_cell['lst_mean']
        tier = first_cell['tier']
        delta = first_cell.get('delta_above_mean', 0)
        print(f"City {c}: Cell {gid} -> LST: {lst}°C, Tier: {tier}, Delta: {delta}°C")

    shap_url = f'http://127.0.0.1:8000/api/v1/drivers?city={c}&grid_id={gid}'
    with urllib.request.urlopen(shap_url) as res:
        shap = json.loads(res.read())
        exp = shap.get('cell_explanation')
        if exp:
            top3 = sorted(exp['shap_values'], key=lambda x: abs(x['shap']), reverse=True)[:3]
            drivers_desc = [f"{d['feature']}: {d['shap']:+.2f}°C" for d in top3]
            print(f"   Top SHAP: {', '.join(drivers_desc)}")
        else:
            print("   No SHAP explanation found")

print("\n=== 2. SHAP Dependence Plot Data Checks ===")
for c in cities[:3]:
    dep_url = f'http://127.0.0.1:8000/api/v1/drivers/dependence?city={c}'
    with urllib.request.urlopen(dep_url) as res:
        data = json.loads(res.read())
        feats = list(data.get('features', {}).keys())
        counts = {k: len(data['features'][k]) for k in feats}
        print(f"City {c} Dependence: features={feats}, sample_counts={counts}")
        assert len(feats) >= 3, f"Expected at least 3 features for dependence, got {len(feats)}"
        for k in feats:
            assert len(data['features'][k]) > 0, f"Expected data points for {k}"

print("\n=== 3. City Hotspot Drivers Checks ===")
for c in cities[:3]:
    hs_url = f'http://127.0.0.1:8000/api/v1/drivers/hotspot-drivers?city={c}'
    with urllib.request.urlopen(hs_url) as res:
        data = json.loads(res.read())
        top_driver = data['hotspot_drivers'][0] if data.get('hotspot_drivers') else None
        print(f"City {c} Hotspot Top Driver: {top_driver}")
        assert top_driver is not None

print("\nALL DRIVER & EXPLAINABILITY VERIFICATIONS PASSED!")
