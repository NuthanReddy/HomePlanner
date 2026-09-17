(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HomePlannerAirflowInputs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const key = ref => JSON.stringify([ref?.floorId, ref?.entityId]);
  const positive = value => Number.isFinite(value) && value > 0;
  const AREA_NOTE = 'Geometric opening-area estimate: width × height × modeled open fraction; upper bound, not verified aerodynamic free area.';

  function weather(project) {
    const data = project.environment?.weather;
    function unavailable(message) {
      const wind = project.environment?.wind;
      if (wind?.source === 'manual' && Number.isFinite(wind.windSpeedMps) && wind.windSpeedMps >= 0 && wind.windSpeedMps <= 150 &&
          Number.isFinite(wind.windFromDeg) && wind.windFromDeg >= 0 && wind.windFromDeg <= 360)
        return { status: 'available', kind: 'hypothetical', timestamp: null, windSpeedMps: wind.windSpeedMps,
          windFromDeg: wind.windFromDeg % 360, source: { label: 'Saved Environment wind scenario' },
          message: `Saved hypothetical wind reference: ${wind.windSpeedMps} m/s from ${wind.windFromDeg % 360}°. Not measured weather or a pressure boundary.` };
      return { status: 'unavailable', message };
    }
    if (!Array.isArray(data?.records) || data.units?.windSpeedMps !== 'm/s' || data.units?.windFromDeg !== 'deg')
      return unavailable('No normalized project wind records. Import weather in Environment if needed; location alone is not a wind record.');
    const records = data.records.filter(row => row && Number.isFinite(Date.parse(row.timestamp)) &&
      Number.isFinite(row.windSpeedMps) && row.windSpeedMps >= 0 && row.windSpeedMps <= 150 &&
      !row.missing?.includes('windSpeedMps') &&
      (row.windSpeedMps === 0 || Number.isFinite(row.windFromDeg) && row.windFromDeg >= 0 && row.windFromDeg <= 360 &&
        !row.missing?.includes('windFromDeg')));
    const row = records.reduce((latest, row) => !latest || Date.parse(row.timestamp) > Date.parse(latest.timestamp) ? row : latest, null);
    if (!row) return unavailable('Saved weather has no valid wind record; missing wind is not calm.');
    const direction = Number.isFinite(row.windFromDeg) && row.windFromDeg >= 0 && row.windFromDeg <= 360 &&
      !row.missing?.includes('windFromDeg') ? row.windFromDeg % 360 : null;
    return { status: 'available', weatherId: data.id ?? null, kind: data.kind ?? 'unclassified',
      timestamp: row.timestamp, windSpeedMps: row.windSpeedMps, windFromDeg: direction,
      source: copy(data.source ?? null), latitude: data.latitude ?? null, longitude: data.longitude ?? null,
      referenceHeightM: data.source?.windReferenceHeightM ?? null,
      message: `Project weather reference: ${row.windSpeedMps} m/s${direction === null ? ' (calm; direction not supplied)' : ` from ${direction}°`} at ${row.timestamp} · ${typeof data.source === 'string' ? data.source : data.source?.label || data.source?.provider || 'Saved weather'}. Latest saved record, not live house wind; pressure coefficients are still required.` };
  }

  function build(inventory, drawingScene, project, draft, previous = null) {
    if (inventory?.kind !== 'AirflowInventory' || !Array.isArray(drawingScene?.scenes) ||
        inventory.projectId !== project.id || drawingScene.projectId !== project.id)
      throw new Error('Use the current project DrawingScene and its discovered airflow inventory.');
    const scenario = copy(draft), issues = [], volumes = [], openingAreas = [];
    const floorScenes = new Map(drawingScene.scenes.map(floor => [floor.floorId, floor]));
    const occupied = new Set([...scenario.zones, ...scenario.links].map(row => row.id));
    function id(prefix) { let index = 1; while (occupied.has(`${prefix}-${index}`)) index++; const value = `${prefix}-${index}`; occupied.add(value); return value; }
    for (const room of inventory.rooms) {
      let zone = scenario.zones.find(zone => key(zone.room) === key(room.ref));
      const added = !zone;
      if (!zone) { zone = { id: id('house-room'), room: copy(room.ref), volumeM3: null }; scenario.zones.push(zone); }
      const floor = floorScenes.get(room.ref.floorId), area = room.usableAreaM2, height = floor?.wallHeightM;
      const volume = positive(area) && positive(height) && positive(area * height) ? area * height : null;
      const source = volume === null ? null :
        `Plan estimate: usable area ${area} m² × supplied wall height ${height} m; not measured clear volume`;
      const prior = previous?.projectId === project.id && previous.volumes?.find(item => item.zoneId === zone.id);
      const managed = added || zone.volumeM3 == null && !zone.volumeSource ||
        prior && zone.volumeM3 === prior.volumeM3 && zone.volumeSource === prior.volumeSource;
      if (managed) {
        zone.volumeM3 = volume;
        zone.volumeSource = source;
        volumes.push({ zoneId: zone.id, roomRef: copy(room.ref), usableAreaM2: area, wallHeightM: height ?? null,
          volumeM3: volume, volumeSource: source });
        if (volume === null) issues.push({ roomRef: copy(room.ref), message: !positive(area)
          ? 'No usable air area remains in this room.'
          : 'Supply this floor’s wall height in Design to estimate room volume.' });
      }
    }
    for (const opening of inventory.openings) {
      let link = scenario.links.find(link => key(link.opening) === key(opening.ref));
      const endpoints = opening.adjacencyStatus === 'known' && opening.candidateAdjacency?.map(side =>
        side.kind === 'outside' ? 'outside' : scenario.zones.find(zone => key(zone.room) === key(side))?.id);
      if (!endpoints || endpoints.length !== 2 || endpoints.some(endpoint => !endpoint)) {
        issues.push({ openingRef: copy(opening.ref), message: 'Opening adjacency needs repair in Design; no outside connection was assumed.' });
        continue;
      }
      const fraction = opening.operation?.openFraction;
      if (!link) {
        link = { id: id('house-opening'), kind: 'opening', opening: copy(opening.ref),
          from: endpoints[0], to: endpoints[1], enabled: fraction !== 0,
          freeAreaM2: null, cd: null, pressurePa: null };
        scenario.links.push(link);
      }
      const cap = Number.isFinite(opening.grossAreaM2) && Number.isFinite(fraction)
        ? opening.grossAreaM2 * fraction : null;
      const proposal = { linkId: link.id, openingRef: copy(opening.ref), geometricCapM2: cap };
      openingAreas.push(proposal);
      const prior = previous?.projectId === project.id && previous.openingAreas?.find(item => item.linkId === link.id && item.applied);
      if (prior && link.freeAreaM2 === prior.geometricCapM2 && link.notes === prior.notes) {
        link.freeAreaM2 = cap;
        proposal.applied = true; proposal.notes = link.notes;
      }
    }
    return { scenario, projectId: project.id, physicalFingerprint: inventory.physicalFingerprint,
      volumes, openingAreas, issues, weather: weather(project) };
  }

  function useOpeningAreas(prepared) {
    const value = copy(prepared);
    for (const proposal of value.openingAreas) {
      const link = value.scenario.links.find(link => link.id === proposal.linkId);
      if (!link || link.freeAreaM2 != null || !Number.isFinite(proposal.geometricCapM2)) continue;
      link.freeAreaM2 = proposal.geometricCapM2;
      link.notes = [link.notes, AREA_NOTE].filter(Boolean).join(' ');
      proposal.applied = true; proposal.notes = link.notes;
    }
    return value;
  }
  return Object.freeze({ build, weather, useOpeningAreas });
});
