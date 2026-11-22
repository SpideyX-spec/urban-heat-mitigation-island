"""
Cooling scenario simulation endpoint.
"""

import json
from fastapi import APIRouter, HTTPException, Depends

from api.schemas import ScenarioRequest, ScenarioResponse, PresetScenario
from pipeline.config import city_presets_file
from api.deps import get_city_id

router = APIRouter(prefix="/api/v1/scenarios", tags=["scenarios"])


@router.post("/simulate", response_model=ScenarioResponse)
async def simulate_scenario(request: ScenarioRequest, city_id: str = Depends(get_city_id)):
    """
    Simulate a custom cooling intervention scenario for one city.
    """
    try:
        from models.simulate import simulate_scenario as run_simulation

        interventions = {i.type: i.intensity for i in request.interventions}

        # Run simulation
        result = run_simulation(
            city_id=city_id,
            interventions=interventions,
            target_cells=request.target_cells,
        )

        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/presets", response_model=list[PresetScenario])
async def get_presets(city_id: str = Depends(get_city_id)):
    """
    Returns list of pre-computed scenario summaries for one city (cached).
    """
    from models.simulate import load_preset_scenarios
    return load_preset_scenarios(city_id)
