// Loads the FM-1 editor protocol layer from the upstream repository (vendor/kriechstrom, a git clone).
// The layer lives inline in web/editor.html between PROTO-BEGIN and PROTO-END; the upstream tests slice it the same way.
// Nothing is copied: this reads the cloned file at start-up.

const SOURCE = new URL("../vendor/kriechstrom/web/editor.html", import.meta.url);

export async function loadProtocol(text) {
  if (text == null) {
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error("Cannot read the protocol layer (" + res.status + "). Run: git clone https://github.com/Xforsa/kriechstrom.git vendor/kriechstrom");
    text = await res.text();
  }
  const a = text.indexOf("/*PROTO-BEGIN*/"), b = text.indexOf("/*PROTO-END*/");
  if (a < 0 || b < a) throw new Error("The protocol markers are missing from the upstream editor.html");
  const body = text.slice(a, b) + `
  return { CMD, req, parse, Link, frame, unframe, makeMockDevice, F, LANES, LANE_NOTE, drumLane, stepLanes,
           pack7, unpack7, strEnc, Reader, UP, SMP, crc32, parseWav, resample, takeSample, autoTrim, rootFromName, buildSlot, normalize,
           v14enc, v14dec, FM6, fmtValue, aliasOf, enumShown, noteName: (n) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1), NOTE_NAMES };`;
  return new Function(body)();
}
