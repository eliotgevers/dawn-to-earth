export const categories = [
  { name: "Aerodynamics", tools: [
    { slug: "airfoil-generator-naca", name: "Airfoil Generator (NACA)" },
    { slug: "lift-drag", name: "Lift & Drag" },
    { slug: "mach-number", name: "Mach Number" },
    { slug: "reynolds-number", name: "Reynolds Number" },
    { slug: "drag-polar-estimator", name: "Drag Polar Estimator" },
  ] },
  { name: "Atmospheric & Flight", tools: [
    { slug: "isa-atmosphere", name: "ISA Atmosphere" },
    { slug: "dynamic-pressure", name: "Dynamic Pressure" },
    { slug: "wing-loading-stall-speed", name: "Wing Loading & Stall Speed" },
    { slug: "performance-envelopes", name: "Performance Envelopes" },
  ] },
  { name: "Navigation", tools: [
    { slug: "wind-components", name: "Wind Components" },
    { slug: "geodesic-distance-bearings", name: "Geodesic Distance & Bearings" },
  ] },
  { name: "Orbital Mechanics", tools: [
    { slug: "orbital-elements", name: "Orbital Elements" },
    { slug: "circular-orbit", name: "Circular Orbit" },
    { slug: "hill-sphere", name: "Hill Sphere" },
  ] },
  { name: "Structures", tools: [
    { slug: "beam-bending-deflection", name: "Beam Bending & Deflection" },
    { slug: "column-buckling", name: "Column Buckling" },
    { slug: "thermal-stress", name: "Thermal Stress" },
    { slug: "natural-frequency", name: "Natural Frequency" },
  ] },
  { name: "Astronomy", tools: [
    { slug: "field-of-view", name: "Field of View" },
    { slug: "pixel-scale-sampling", name: "Pixel Scale & Sampling" },
  ] },
  { name: "General Utilities", tools: [
    { slug: "unit-converter", name: "Unit Converter" },
    { slug: "cost-analysis", name: "Cost Analysis" },
  ] },
] as const;

export type AeroViaTool = (typeof categories)[number]["tools"][number];
