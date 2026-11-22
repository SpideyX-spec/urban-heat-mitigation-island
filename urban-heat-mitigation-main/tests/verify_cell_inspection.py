import urllib.request
import json

cities = ['new_delhi', 'mumbai', 'bengaluru', 'chennai', 'kolkata']
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
