import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildCanonicalHydraulicModel,
  canonicalToLongitudinalInput,
  canonicalToSteadyNetwork,
  type MeasurementPoint,
  type Node,
  type Pipe,
} from "../index.js";

const nodes: Node[] = [
  { id: "N-01", nodeType: "reservoir", elevation: 100, hydraulicGrade: 110 },
  { id: "N-02", nodeType: "junction", elevation: 90 },
  { id: "N-03", nodeType: "valve_node", elevation: 80 },
];

const pipes: Pipe[] = [
  { id: "P-01", startNodeId: "N-01", endNodeId: "N-02", pipeType: "ductile_iron", innerDiameter: 0.6, wallThickness: 0.01, length: 100, roughnessCoeff: 130 },
  { id: "P-02", startNodeId: "N-02", endNodeId: "N-03", pipeType: "steel", innerDiameter: 0.4, wallThickness: 0.008, length: 80, roughnessCoeff: 120 },
];

function point(overrides: Partial<MeasurementPoint> & Pick<MeasurementPoint, "id">): MeasurementPoint {
  return {
    horizontalDistance: 0,
    groundLevel: 90,
    pipeCenterHeight: 88,
    pipeLength: 0,
    flowRate: 0.2,
    diameter: 0.6,
    roughnessC: 130,
    bendLossCoeff: 0,
    valveLossCoeff: 0,
    branchLossCoeff: 0,
    ...overrides,
  };
}

describe("canonical hydraulic model", () => {
  test("keeps pipe properties authoritative and links measurement points explicitly", () => {
    const built = buildCanonicalHydraulicModel({
      source: "excel",
      crs: "EPSG:6677",
      nodes,
      pipes,
      measurementPoints: [
        point({ id: "MP-01", pipeId: "P-01", nodeId: "N-01", distanceAlongPipe: 0 }),
        point({ id: "MP-02", pipeId: "P-01", distanceAlongPipe: 40, pipeLength: 40, diameter: 0.5 }),
      ],
    });

    assert.equal(built.model.version, 1);
    assert.equal(built.model.measurementPoints[0]?.nodeId, "N-01");
    assert.equal(built.model.measurementPoints[1]?.pipeId, "P-01");
    assert.ok(built.issues.some(({ code, entityId }) => code === "DUPLICATE_DIAMETER_IGNORED" && entityId === "MP-02"));
    const longitudinal = canonicalToLongitudinalInput(built.model, 110);
    assert.equal(longitudinal.value?.points[1]?.diameter, 0.6);
    assert.equal(longitudinal.value?.points[1]?.roughnessC, 130);
  });

  test("infers legacy point-to-pipe links from ordered slope length", () => {
    const built = buildCanonicalHydraulicModel({
      source: "legacy",
      nodes,
      pipes,
      measurementPoints: [
        point({ id: "MP-01", pipeLength: 60 }),
        point({ id: "MP-02", pipeLength: 60, diameter: 0.4, roughnessC: 120 }),
      ],
    });

    assert.equal(built.model.measurementPoints[0]?.pipeId, "P-01");
    assert.equal(built.model.measurementPoints[0]?.distanceAlongPipe, 60);
    assert.equal(built.model.measurementPoints[1]?.pipeId, "P-02");
    assert.equal(built.model.measurementPoints[1]?.distanceAlongPipe, 20);
    assert.equal(built.issues.filter(({ code }) => code === "POINT_PIPE_INFERRED").length, 2);
  });

  test("fills an omitted distance from ordered lengths when the pipe reference is explicit", () => {
    const built = buildCanonicalHydraulicModel({
      source: "excel",
      nodes,
      pipes: [pipes[0]!],
      measurementPoints: [
        point({ id: "MP-01", pipeId: "P-01", pipeLength: 30 }),
        point({ id: "MP-02", pipeId: "P-01", pipeLength: 45 }),
      ],
    });

    assert.equal(built.model.measurementPoints[0]?.distanceAlongPipe, 30);
    assert.equal(built.model.measurementPoints[1]?.distanceAlongPipe, 75);
    assert.equal(built.model.hydraulicUnits.length, 1);
    assert.equal(built.model.hydraulicUnits[0]?.designFlow, 0.2);
  });

  test("splits hydraulic units when design flow changes on one pipe", () => {
    const built = buildCanonicalHydraulicModel({
      source: "excel",
      nodes,
      pipes: [pipes[0]!],
      measurementPoints: [
        point({ id: "MP-01", pipeId: "P-01", distanceAlongPipe: 0, flowRate: 0.2 }),
        point({ id: "MP-02", pipeId: "P-01", distanceAlongPipe: 55, pipeLength: 55, flowRate: 0.1 }),
      ],
    });

    assert.deepEqual(built.model.hydraulicUnits.map(({ fromDistance, toDistance, designFlow }) => ({ fromDistance, toDistance, designFlow })), [
      { fromDistance: 0, toDistance: 55, designFlow: 0.2 },
      { fromDistance: 55, toDistance: 100, designFlow: 0.1 },
    ]);
  });

  test("converts the same canonical topology to steady-network input", () => {
    const built = buildCanonicalHydraulicModel({ source: "web", nodes, pipes, measurementPoints: [] });
    const steady = canonicalToSteadyNetwork(built.model);
    assert.equal(steady.issues.length, 0);
    assert.deepEqual(steady.value?.pipes[0], {
      id: "P-01",
      upstreamNodeId: "N-01",
      downstreamNodeId: "N-02",
      innerDiameter: 0.6,
      length: 100,
      roughnessC: 130,
    });
    assert.deepEqual(steady.value?.nodes.map(({ id, type }) => ({ id, type })), [
      { id: "N-01", type: "reservoir" },
      { id: "N-02", type: "junction" },
      { id: "N-03", type: "junction" },
    ]);
  });
});
