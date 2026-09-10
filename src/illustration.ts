/** Strict, static SVG subset. No scripts, links, embedded resources, CSS, or filters. */
export function validateIllustration(raw: string): string {
  const text = raw
    .trim()
    .replace(/^```(?:svg|xml)?\s*/i, "")
    .replace(/\s*```$/, "");
  if (text.length > 120000 || /<!|<\?/.test(text))
    throw new Error("The illustration contains unsupported markup.");
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.localName !== "svg"
  )
    throw new Error("The provider did not return a valid SVG illustration.");
  const tags = new Set([
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "title",
    "desc",
  ]);
  const attrs = new Set([
    "xmlns",
    "viewBox",
    "width",
    "height",
    "x",
    "y",
    "x1",
    "x2",
    "y1",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "d",
    "points",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "transform",
    "font-size",
    "font-family",
    "font-weight",
    "text-anchor",
    "dominant-baseline",
    "dx",
    "dy",
    "fill-rule",
  ]);
  const all = [
    doc.documentElement,
    ...doc.documentElement.querySelectorAll("*"),
  ];
  if (all.length > 1000) throw new Error("The illustration is too complex.");
  for (const node of all) {
    if (
      !tags.has(node.localName) ||
      node.namespaceURI !== "http://www.w3.org/2000/svg"
    )
      throw new Error("The illustration contains unsupported elements.");
    for (const attr of node.attributes) {
      if (
        !attrs.has(attr.name) ||
        (/url\s*\(|javascript:|data:|https?:|[<>]/i.test(attr.value) &&
          attr.name !== "xmlns")
      )
        throw new Error("The illustration contains unsafe attributes.");
    }
  }
  const box = doc.documentElement
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    !box ||
    box.length !== 4 ||
    !box.every(Number.isFinite) ||
    box[2] <= 0 ||
    box[3] <= 0 ||
    box[2] > 4096 ||
    box[3] > 4096
  )
    throw new Error(
      "The illustration needs a valid viewBox up to 4096 pixels.",
    );
  doc.documentElement.setAttribute("width", String(box[2]));
  doc.documentElement.setAttribute("height", String(box[3]));
  return new XMLSerializer().serializeToString(doc.documentElement);
}

export async function rasterizeIllustration(
  svg: string,
): Promise<{ dataURL: string; width: number; height: number }> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(image.width * scale);
    canvas.height = Math.ceil(image.height * scale);
    canvas
      .getContext("2d")!
      .drawImage(image, 0, 0, canvas.width, canvas.height);
    return {
      dataURL: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
