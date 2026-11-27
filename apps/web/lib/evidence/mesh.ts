// Plain OBJ geometry only. External resources and material libraries are unsupported.
export function readMesh(text: string) {
  const vertices: number[][] = [];
  const triangles: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const row = line.split("#", 1)[0].trim();
    if (!row) continue;
    const [tag, ...values] = row.split(/\s+/);
    if (tag === "g" || tag === "o") continue;
    if (tag === "v" && values.length === 3) {
      const point = values.map(Number);
      if (!point.every(v => Number.isFinite(v) && Math.abs(v) <= 100_000)) throw Error("OBJ coordinates must be finite and within ±100,000.");
      vertices.push(point);
    } else if (tag === "f" && (values.length === 3 || values.length === 4)) {
      const indices = values.map(value => /^\d+$/.test(value) ? Number(value) - 1 : -1);
      if (indices.some(i => i < 0 || i >= vertices.length)) throw Error("OBJ faces must refer to earlier vertices by positive index.");
      triangles.push(indices[0], indices[1], indices[2]);
      if (indices.length === 4) triangles.push(indices[0], indices[2], indices[3]);
    } else {
      throw Error("Use plain OBJ vertices and triangular or quadrilateral faces. Textures and external files are unsupported.");
    }
    if (vertices.length > 8192 || triangles.length > 49152) throw Error("The model exceeds 8,192 vertices or 16,384 triangles.");
  }

  if (!triangles.length || !triangles.some((a, i) => {
    if (i % 3) return false;
    const p = vertices[a], q = vertices[triangles[i+1]], r = vertices[triangles[i+2]];

    return [0, 1, 2].some((c) => {
      const d = (c + 1) % 3;

      return (q[c]-p[c])*(r[d]-p[d]) !== (q[d]-p[d])*(r[c]-p[c]);
    });
  })) throw Error("The OBJ must contain a visible face.");

  return { vertices, triangles };
}
