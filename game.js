const BEST_KEY = "desigual-mejor-puntaje";
const MUTE_KEY = "desigual-sonido";
const TIME_DS = 400;
const TOTAL = 12;

const RULES = [
  {
    title: "Aditiva",
    text: "Sumar o restar el mismo número en ambos lados conserva el sentido.",
    example: "3 < 8  →  5 < 10",
  },
  {
    title: "Factor positivo",
    text: "Multiplicar o dividir por un positivo conserva el sentido.",
    example: "−2 < 4  →  −6 < 12",
  },
  {
    title: "Factor negativo",
    text: "Multiplicar o dividir por un negativo invierte el sentido. Por cero, ambos lados quedan en 0.",
    example: "1 < 4  →  −2 > −8",
  },
  {
    title: "Transitiva",
    text: "Si a < b y b < c, entonces a < c. El mismo encadenamiento vale con >.",
    example: "1 < 4 y 4 < 9  →  1 < 9",
  },
  {
    title: "Suma del mismo sentido",
    text: "Si a < b y c < d, entonces a + c < b + d. Restarlas o multiplicarlas entre sí no es seguro.",
    example: "1 < 4 y 2 < 5  →  3 < 9",
  },
];

const PROP_NAME = {
  aditiva: "Propiedad aditiva",
  positivo: "Factor positivo",
  negativo: "Factor negativo",
  transitiva: "Propiedad transitiva",
  suma: "Suma del mismo sentido",
  criterio: "Qué sí se puede afirmar",
  cero: "Multiplicar por cero",
};

const PROP_ORDER = ["aditiva", "positivo", "negativo", "transitiva", "suma", "criterio", "cero"];

const NAME_CHOICES = [
  { id: "aditiva", label: "Propiedad aditiva" },
  { id: "positivo", label: "Multiplicativa con positivo" },
  { id: "negativo", label: "Multiplicativa con negativo" },
  { id: "transitiva", label: "Propiedad transitiva" },
];

let fallbackCount = 0;

const state = {
  screen: "home",
  questions: [],
  index: 0,
  score: 0,
  lives: 3,
  streak: 0,
  bestStreak: 0,
  correct: 0,
  answered: 0,
  locked: false,
  left: TIME_DS,
  timer: null,
  log: [],
  stats: {},
  record: false,
  previousBest: 0,
};

const audio = {
  muted: false,
  ctx: null,
};

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function fmt(n) {
  if (n < 0) return `−${Math.abs(n)}`;
  return String(n);
}

function compare(a, b) {
  if (a < b) return "<";
  if (a > b) return ">";
  return "=";
}

function flipSense(sense) {
  if (sense === "<") return ">";
  if (sense === ">") return "<";
  return "=";
}

function expr(a, sense, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  if (a === b) return null;
  return `${fmt(a)} ${sense} ${fmt(b)}`;
}

function parseIneq(label) {
  const match = /^(−?\d+) ([<>=]) (−?\d+)$/.exec(String(label).trim());
  if (!match) return null;
  const num = (token) => Number(token.replace(/−/g, "-"));
  return { a: num(match[1]), op: match[2], b: num(match[3]) };
}

function relationKey(label) {
  const parsed = parseIneq(label);
  if (!parsed) return String(label);
  if (parsed.op === "=") {
    return `${Math.min(parsed.a, parsed.b)}=${Math.max(parsed.a, parsed.b)}`;
  }
  const left = parsed.op === "<" ? parsed.a : parsed.b;
  const right = parsed.op === "<" ? parsed.b : parsed.a;
  return `${left}<${right}`;
}

function statementIsTrue(label) {
  const parsed = parseIneq(label);
  if (!parsed) return false;
  if (parsed.op === "<") return parsed.a < parsed.b;
  if (parsed.op === ">") return parsed.a > parsed.b;
  return parsed.a === parsed.b;
}

function guaranteedFalse(seedA, seedB) {
  return [
    expr(seedA, "<", seedA - 1),
    expr(seedA, ">", seedA + 1),
    expr(seedB, "<", seedB - 2),
    expr(seedB, ">", seedB + 2),
    expr(seedA - 3, ">", seedA),
    expr(seedB + 3, "<", seedB),
  ];
}

const MATH_FAMILIES = {
  add: true,
  sub: true,
  mulpos: true,
  mulneg: true,
  divpos: true,
  divneg: true,
  transitiva: true,
  suma: true,
};

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function distinctInts(count, min, max) {
  const set = new Set();
  let guard = 0;
  while (set.size < count && guard < 80) {
    set.add(randInt(min, max));
    guard += 1;
  }
  if (set.size < count) return null;
  return [...set];
}

function fillOptions(correct, pool, banned) {
  if (!correct) return null;
  const blocked = new Set(banned || []);
  const keys = new Set([relationKey(correct)]);
  (banned || []).forEach((line) => keys.add(relationKey(line)));
  const labels = [correct];
  shuffle(pool.filter(Boolean)).forEach((item) => {
    if (labels.length >= 4) return;
    if (blocked.has(item) || labels.includes(item)) return;
    const key = relationKey(item);
    if (keys.has(key)) return;
    if (statementIsTrue(item)) return;
    labels.push(item);
    keys.add(key);
  });
  if (labels.length !== 4) return null;
  return shuffle(labels.map((label) => ({ label, correct: label === correct })));
}

function validChoiceQuestion(question) {
  if (!question || !Array.isArray(question.options) || question.options.length !== 4) return false;
  if (question.options.filter((option) => option.correct).length !== 1) return false;
  const labels = question.options.map((option) => option.label);
  if (labels.some((label) => !label || !String(label).trim())) return false;
  if (new Set(labels).size !== 4) return false;
  if (new Set(labels.map(relationKey)).size !== 4) return false;
  const lineKeys = new Set((question.lines || []).map(relationKey));
  if (labels.some((label) => (question.lines || []).includes(label) || lineKeys.has(relationKey(label)))) return false;
  if (MATH_FAMILIES[question.family]) {
    const trueOnes = question.options.filter((option) => statementIsTrue(option.label));
    if (trueOnes.length !== 1 || !trueOnes[0].correct) return false;
  }
  const correct = question.options.find((option) => option.correct);
  if (question.expect && correct.label !== question.expect) return false;
  if (typeof question.audit === "function" && !question.audit()) return false;
  return true;
}

function cloneFallback() {
  return {
    tag: "Calcula el resultado",
    property: "aditiva",
    family: "add",
    lines: ["2 < 5"],
    note: "Suma 3 en ambos lados.",
    lead: "¿Qué desigualdad obtienes?",
    options: shuffle([
      { label: "5 < 8", correct: true },
      { label: "5 > 8", correct: false },
      { label: "5 < 2", correct: false },
      { label: "8 < 3", correct: false },
    ]),
    explain: "Sumar 3 conserva el sentido: 2 < 5 pasa a 5 < 8.",
    expect: "5 < 8",
    proof: {
      kind: "add",
      left: 2,
      right: 5,
      sense: "<",
      newL: 5,
      newR: 8,
      newSense: "<",
      delta: 3,
      correct: "5 < 8",
    },
  };
}

function safe(factory) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const question = factory();
      if (validChoiceQuestion(question)) return question;
    } catch (error) {
      /* otro intento */
    }
  }
  fallbackCount += 1;
  return cloneFallback();
}

function attemptApply(family) {
  let left;
  let right;
  let sense;
  let newL;
  let newR;
  let newSense;
  let note;
  let explain;
  let property;
  let proof;
  let pool;

  if (family === "add" || family === "sub") {
    left = randInt(-8, 7);
    right = left + randInt(1, 9);
    if (Math.random() < 0.5) [left, right] = [right, left];
    sense = compare(left, right);
    const amount = randInt(1, 8);
    const delta = family === "sub" ? -amount : amount;
    newL = left + delta;
    newR = right + delta;
    newSense = sense;
    property = "aditiva";
    note = family === "sub"
      ? `Resta ${amount} en ambos lados.`
      : `Suma ${amount} en ambos lados.`;
    explain = family === "sub"
      ? `Restar ${amount} equivale a sumar ${fmt(-amount)}. El sentido se conserva: ${expr(left, sense, right)} pasa a ${expr(newL, newSense, newR)}.`
      : `Sumar ${amount} en ambos lados conserva el sentido: ${expr(left, sense, right)} pasa a ${expr(newL, newSense, newR)}.`;
    proof = { kind: "add", left, right, sense, newL, newR, newSense, delta, correct: expr(newL, newSense, newR) };
    pool = [
      expr(newL, flipSense(newSense), newR),
      expr(left + delta, sense, right),
      expr(left, sense, right + delta),
      expr(left - delta, sense, right - delta),
      expr(left + delta, sense, right - delta),
      expr(left, flipSense(sense), right),
      ...guaranteedFalse(newL, newR),
    ];
  } else if (family === "mulpos" || family === "mulneg") {
    const factor = family === "mulneg" ? -randInt(2, 5) : randInt(2, 5);
    left = randInt(-6, 6);
    right = randInt(-6, 6);
    if (left === right) return null;
    sense = compare(left, right);
    newL = left * factor;
    newR = right * factor;
    newSense = factor < 0 ? flipSense(sense) : sense;
    if (compare(newL, newR) !== newSense) return null;
    property = factor < 0 ? "negativo" : "positivo";
    note = `Multiplica ambos lados por ${fmt(factor)}.`;
    explain = factor < 0
      ? `El factor ${fmt(factor)} es negativo, así que el sentido se invierte: ${expr(left, sense, right)} pasa a ${expr(newL, newSense, newR)}.`
      : `El factor ${factor} es positivo, así que el sentido se conserva: ${expr(left, sense, right)} pasa a ${expr(newL, newSense, newR)}.`;
    proof = { kind: "mul", left, right, sense, newL, newR, newSense, factor, correct: expr(newL, newSense, newR) };
    pool = [
      expr(newL, flipSense(newSense), newR),
      expr(left * factor, sense, right),
      expr(left, sense, right * factor),
      expr(left * -factor, sense, right * -factor),
      expr(left + factor, sense, right + factor),
      expr(left, flipSense(sense), right),
      ...guaranteedFalse(newL, newR),
    ];
  } else {
    const factor = family === "divneg" ? -randInt(2, 5) : randInt(2, 5);
    const qL = randInt(-7, 7);
    const qR = randInt(-7, 7);
    if (qL === qR) return null;
    left = qL * factor;
    right = qR * factor;
    sense = compare(left, right);
    newL = qL;
    newR = qR;
    newSense = factor < 0 ? flipSense(sense) : sense;
    if (compare(newL, newR) !== newSense) return null;
    property = factor < 0 ? "negativo" : "positivo";
    note = `Divide ambos lados entre ${fmt(factor)}.`;
    explain = factor < 0
      ? `Dividir entre ${fmt(factor)} invierte el sentido, porque el divisor es negativo: ${expr(left, sense, right)} pasa a ${expr(newL, newSense, newR)}.`
      : `Dividir entre ${factor} conserva el sentido, porque el divisor es positivo: ${expr(left, sense, right)} pasa a ${expr(newL, newSense, newR)}.`;
    proof = { kind: "div", left, right, sense, newL, newR, newSense, factor, correct: expr(newL, newSense, newR) };
    pool = [
      expr(newL, flipSense(newSense), newR),
      expr(newL, sense, right),
      expr(left, sense, newR),
      expr(left + factor, sense, right + factor),
      expr(left, flipSense(sense), right),
      ...guaranteedFalse(newL, newR),
    ];
  }

  const given = expr(left, sense, right);
  const correct = expr(newL, newSense, newR);
  const options = fillOptions(correct, pool, [given]);
  if (!options) return null;
  proof.correct = correct;

  return {
    tag: "Calcula el resultado",
    property,
    family,
    lines: [expr(left, sense, right)],
    note,
    lead: "¿Qué desigualdad obtienes?",
    options,
    explain,
    expect: correct,
    proof,
    audit() {
      return compare(newL, newR) === newSense && expr(newL, newSense, newR) === correct;
    },
  };
}

function attemptSense() {
  const variants = [
    {
      note: "Sumas 6 en ambos lados.",
      answer: "El sentido se conserva",
      property: "aditiva",
      explain: "Sumar el mismo número en ambos lados conserva el sentido, valgan lo que valgan a y b.",
    },
    {
      note: "Restas 8 en ambos lados.",
      answer: "El sentido se conserva",
      property: "aditiva",
      explain: "Restar el mismo número es la propiedad aditiva. El sentido se conserva.",
    },
    {
      note: "Multiplicas ambos lados por 4.",
      answer: "El sentido se conserva",
      property: "positivo",
      explain: "4 es positivo, así que el sentido se conserva para cualquier a < b.",
    },
    {
      note: "Divides ambos lados entre 3.",
      answer: "El sentido se conserva",
      property: "positivo",
      explain: "3 es positivo, así que el sentido se conserva.",
    },
    {
      note: "Multiplicas ambos lados por −2.",
      answer: "El sentido se invierte",
      property: "negativo",
      explain: "−2 es negativo, así que el sentido se invierte: si a < b, entonces −2a > −2b.",
    },
    {
      note: "Divides ambos lados entre −5.",
      answer: "El sentido se invierte",
      property: "negativo",
      explain: "−5 es negativo, así que el sentido se invierte. No hace falta conocer a ni b.",
    },
    {
      note: "Multiplicas ambos lados por −1.",
      answer: "El sentido se invierte",
      property: "negativo",
      explain: "Multiplicar por −1 cambia el signo de ambos lados y el sentido: si a < b, entonces −a > −b.",
    },
  ];
  const negative = variants.filter((item) => item.answer === "El sentido se invierte");
  const variant = Math.random() < 0.7 ? pick(negative) : pick(variants);
  const labels = [
    "El sentido se conserva",
    "El sentido se invierte",
    "Se convierte en igualdad",
    "Depende de los valores de a y b",
  ];
  return {
    tag: "El sentido",
    property: variant.property,
    family: "sentido",
    lines: ["a < b"],
    note: variant.note,
    lead: "¿Qué ocurre con el sentido?",
    options: shuffle(labels.map((label) => ({ label, correct: label === variant.answer }))),
    explain: variant.explain,
    expect: variant.answer,
    proof: { kind: "sense", answer: variant.answer },
  };
}

function attemptName() {
  const kind = pick(["add", "mulpos", "mulneg", "divneg", "trans"]);
  let lines;
  let note;
  let property;
  let explain;

  if (kind === "add") {
    let left = randInt(-6, 6);
    let right = left + randInt(1, 8);
    if (Math.random() < 0.5) [left, right] = [right, left];
    const sense = compare(left, right);
    const delta = randInt(1, 7) * (Math.random() < 0.35 ? -1 : 1);
    lines = [expr(left, sense, right), expr(left + delta, sense, right + delta)];
    note = delta > 0
      ? `Se sumó ${delta} en ambos lados.`
      : `Se sumó ${fmt(delta)} en ambos lados.`;
    property = "aditiva";
    explain = "Se sumó el mismo número en ambos lados y el sentido se conservó. Esa es la propiedad aditiva.";
  } else if (kind === "mulpos" || kind === "mulneg") {
    const factor = kind === "mulneg" ? -randInt(2, 4) : randInt(2, 5);
    const left = randInt(-5, 5);
    const right = randInt(-5, 5);
    if (left === right) return null;
    const sense = compare(left, right);
    const newSense = factor < 0 ? flipSense(sense) : sense;
    if (compare(left * factor, right * factor) !== newSense) return null;
    lines = [expr(left, sense, right), expr(left * factor, newSense, right * factor)];
    note = `Se multiplicó ambos lados por ${fmt(factor)}.`;
    property = factor < 0 ? "negativo" : "positivo";
    explain = factor < 0
      ? `El factor ${fmt(factor)} es negativo y el sentido se invirtió. Es la propiedad multiplicativa con factor negativo.`
      : `El factor ${factor} es positivo y el sentido se conservó. Es la propiedad multiplicativa con factor positivo.`;
  } else if (kind === "divneg") {
    const factor = -randInt(2, 4);
    const qL = randInt(-6, 6);
    const qR = randInt(-6, 6);
    if (qL === qR) return null;
    const left = qL * factor;
    const right = qR * factor;
    const sense = compare(left, right);
    const newSense = flipSense(sense);
    if (compare(qL, qR) !== newSense) return null;
    lines = [expr(left, sense, right), expr(qL, newSense, qR)];
    note = `Se dividió ambos lados entre ${fmt(factor)}.`;
    property = "negativo";
    explain = `Dividir entre ${fmt(factor)} es multiplicar por un recíproco negativo, así que el sentido se invierte.`;
  } else {
    const nums = distinctInts(3, -3, 11);
    if (!nums) return null;
    nums.sort((a, b) => a - b);
    const [x, y, z] = nums;
    lines = [expr(x, "<", y), expr(y, "<", z), expr(x, "<", z)];
    note = "De las dos primeras se concluye la tercera.";
    property = "transitiva";
    explain = "Si un número es menor que otro y ese es menor que un tercero, el primero es menor que el tercero. Eso es la propiedad transitiva.";
  }

  if (!lines || lines.some((line) => !line)) return null;

  return {
    tag: "Nombra la propiedad",
    property,
    family: "nombre",
    lines,
    note,
    lead: "¿Qué propiedad justifica este paso?",
    options: shuffle(NAME_CHOICES.map((choice) => ({
      label: choice.label,
      correct: choice.id === property,
    }))),
    explain,
    expect: NAME_CHOICES.find((choice) => choice.id === property).label,
    proof: { kind: "name", property },
  };
}

function attemptTransitive() {
  const nums = distinctInts(3, -6, 12);
  if (!nums) return null;
  nums.sort((a, b) => a - b);
  const [x, y, z] = nums;
  const greater = Math.random() < 0.5;
  const lines = greater
    ? [expr(z, ">", y), expr(y, ">", x)]
    : [expr(x, "<", y), expr(y, "<", z)];
  const correct = greater ? expr(z, ">", x) : expr(x, "<", z);
  const pool = greater
    ? [expr(z, "<", x), `${fmt(z)} = ${fmt(x)}`, expr(z, "<", y), expr(y, "<", x), ...guaranteedFalse(z, x)]
    : [expr(x, ">", z), `${fmt(x)} = ${fmt(z)}`, expr(x, ">", y), expr(y, ">", z), ...guaranteedFalse(x, z)];
  const options = fillOptions(correct, pool, lines);
  if (!options) return null;
  const explain = greater
    ? `Como ${expr(z, ">", y)} y ${expr(y, ">", x)}, la propiedad transitiva da ${correct}.`
    : `Como ${expr(x, "<", y)} y ${expr(y, "<", z)}, la propiedad transitiva da ${correct}.`;
  return {
    tag: "Propiedad transitiva",
    property: "transitiva",
    family: "transitiva",
    lines,
    note: "Mira la relación entre los extremos.",
    lead: "¿Qué puedes concluir?",
    options,
    explain,
    expect: correct,
    proof: { kind: "trans", x, y, z, greater, correct },
    audit() {
      if (greater) return z > y && y > x && correct === expr(z, ">", x);
      return x < y && y < z && correct === expr(x, "<", z);
    },
  };
}

function attemptSum() {
  const sense = Math.random() < 0.5 ? "<" : ">";
  let a = randInt(-6, 5);
  let b = a + randInt(1, 8);
  let c = randInt(-6, 5);
  let d = c + randInt(1, 8);
  if (sense === ">") {
    [a, b] = [b, a];
    [c, d] = [d, c];
  }
  if (compare(a, b) !== sense || compare(c, d) !== sense) return null;
  const newL = a + c;
  const newR = b + d;
  if (compare(newL, newR) !== sense) return null;
  const correct = expr(newL, sense, newR);
  const options = fillOptions(correct, [
    expr(newL, flipSense(sense), newR),
    expr(a - c, sense, b - d),
    expr(a + d, sense, b + c),
    expr(a + b, sense, c + d),
    expr(a - d, sense, b - c),
    ...guaranteedFalse(newL, newR),
  ], [expr(a, sense, b), expr(c, sense, d)]);
  if (!options) return null;
  return {
    tag: "Suma de desigualdades",
    property: "suma",
    family: "suma",
    lines: [expr(a, sense, b), expr(c, sense, d)],
    note: "Suma lado a lado. Las dos apuntan al mismo sentido.",
    lead: "¿Qué desigualdad obtienes?",
    options,
    explain: `Las desigualdades del mismo sentido se pueden sumar: ${correct}. Restarlas no seguiría una regla general.`,
    expect: correct,
    proof: { kind: "sum", a, b, c, d, sense, correct },
    audit() {
      return compare(a, b) === sense
        && compare(c, d) === sense
        && compare(a + c, b + d) === sense
        && correct === expr(a + c, sense, b + d);
    },
  };
}

function attemptAlways() {
  const correct = "a + c < b + d";
  return {
    tag: "Qué sí se puede afirmar",
    property: "criterio",
    family: "criterio",
    lines: ["a < b", "c < d"],
    note: "a, b, c y d son números reales.",
    lead: "¿Qué es siempre verdadero?",
    options: shuffle([
      { label: correct, correct: true },
      { label: "a − c < b − d", correct: false },
      { label: "a · c < b · d", correct: false },
      { label: "a + c > b + d", correct: false },
    ]),
    explain: "Solo la suma está garantizada. Restar o multiplicar las desigualdades entre sí puede fallar. Por ejemplo, −3 < 2 y −4 < 1, pero (−3)(−4) no es menor que 2·1.",
    expect: correct,
    proof: { kind: "always", correct },
  };
}

function attemptZero() {
  const correct = "Queda 0 = 0";
  return {
    tag: "Caso aparte",
    property: "cero",
    family: "cero",
    lines: ["a < b"],
    note: "Multiplicas ambos lados por 0.",
    lead: "¿Qué obtienes?",
    options: shuffle([
      { label: "El sentido se conserva", correct: false },
      { label: "El sentido se invierte", correct: false },
      { label: correct, correct: true },
      { label: "Queda a = b", correct: false },
    ]),
    explain: "Multiplicar por 0 anula los dos lados. La propiedad multiplicativa pide un factor distinto de cero; con 0 la desigualdad estricta desaparece y queda 0 = 0.",
    expect: correct,
    proof: { kind: "zero", correct },
  };
}

function takeFresh(factory, used) {
  let last = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    last = safe(factory);
    const signature = [
      last.family,
      ...(last.lines || []),
      last.note,
      last.options.map((option) => relationKey(option.label)).sort().join(","),
    ].join("|");
    if (!used.has(signature)) {
      used.add(signature);
      return last;
    }
  }
  return last;
}

function buildRound() {
  const used = new Set();
  const early = shuffle([
    () => attemptApply("add"),
    () => attemptApply("sub"),
    () => attemptApply("mulpos"),
    () => attemptApply("divpos"),
  ]).map((factory) => takeFresh(factory, used));

  const mid = shuffle([
    () => attemptApply("mulneg"),
    () => attemptApply("divneg"),
    () => attemptApply(Math.random() < 0.5 ? "mulneg" : "divneg"),
    () => attemptSense(),
  ]).map((factory) => takeFresh(factory, used));

  const late = shuffle([
    () => attemptName(),
    () => attemptTransitive(),
    () => attemptSum(),
    () => (Math.random() < 0.5 ? attemptAlways() : attemptZero()),
  ]).map((factory) => takeFresh(factory, used));

  return [...early, ...mid, ...late];
}

function readBest() {
  try {
    const value = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch (error) {
    return 0;
  }
}

function writeBest(score) {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch (error) {
    /* el récord se queda en la partida */
  }
}

function readMute() {
  try {
    return localStorage.getItem(MUTE_KEY) === "no";
  } catch (error) {
    return false;
  }
}

function writeMute(muted) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "no" : "si");
  } catch (error) {
    /* sin almacenamiento el silencio dura solo esta visita */
  }
}

function ensureAudio() {
  if (audio.muted || audio.ctx) return;
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    audio.ctx = new Context();
  } catch (error) {
    audio.muted = true;
  }
}

function tone(freq, duration, delay) {
  if (audio.muted || !audio.ctx) return;
  try {
    const start = audio.ctx.currentTime + delay;
    const oscillator = audio.ctx.createOscillator();
    const gain = audio.ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.05, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(audio.ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  } catch (error) {
    audio.muted = true;
  }
}

function playOk() {
  ensureAudio();
  tone(523, 0.12, 0);
  tone(659, 0.16, 0.08);
}

function playBad() {
  ensureAudio();
  tone(196, 0.22, 0);
}

function pointsFor(streakAfter, decisecondsLeft) {
  const multiplier = Math.min(streakAfter, 4);
  const speed = Math.ceil(decisecondsLeft / 10) * 2;
  return { multiplier, speed, points: multiplier * 100 + speed };
}

function stopTimer() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

function mount(html) {
  document.getElementById("app").innerHTML = html;
}

function livesLabel(count) {
  const n = Math.max(0, count);
  return n === 1 ? "1 vida" : `${n} vidas`;
}

function heart(on) {
  const fill = on ? "var(--red)" : "none";
  const extra = on ? "" : " heart-off";
  return `<svg class="${extra.trim()}" width="22" height="20" viewBox="0 0 22 20" aria-hidden="true"><path d="M11 17.5 2.6 9.6A4.2 4.2 0 0 1 11 4.2 4.2 4.2 0 0 1 19.4 9.6L11 17.5Z" fill="${on ? "#c4322a" : "none"}" stroke="#1a1714" stroke-width="1.7"/></svg>`;
}

function renderHome() {
  const best = readBest();
  const rules = RULES.map((rule) => `
    <article class="rule">
      <h3>${esc(rule.title)}</h3>
      <p>${esc(rule.text)}</p>
      <p class="example">${esc(rule.example)}</p>
    </article>
  `).join("");

  mount(`
    <main class="shell">
      <div class="topbar">
        <span class="mark">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M16 3 L5 11 L16 19" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>
          Desigual
        </span>
        <button type="button" class="ghost" id="mute">${audio.muted ? "Sonido: no" : "Sonido: sí"}</button>
      </div>
      <header class="hero">
        <p class="kicker">Matemáticas</p>
        <div class="hero-title">
          <svg class="hero-sign" viewBox="0 0 80 120" aria-hidden="true">
            <path d="M68 8 L12 60 L68 112" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="square"/>
          </svg>
          <h1>Desigual</h1>
        </div>
        <p class="lede">Practica las propiedades de las desigualdades. Doce preguntas, tres vidas y una racha que multiplica el puntaje. Si multiplicas o divides por un negativo, el sentido cambia.</p>
        <div class="actions">
          <button type="button" class="primary" id="start">Empezar partida</button>
          ${best ? `<p class="record-chip"><span>Mejor puntaje</span>${best}</p>` : ""}
        </div>
      </header>
      <section class="scoring" aria-label="Cómo se puntúa">
        <article class="score-bit"><strong>×4</strong><span>100 puntos por la racha, hasta ×4</span></article>
        <article class="score-bit"><strong>+2</strong><span>puntos por cada segundo que sobre</span></article>
        <article class="score-bit"><strong>3 vidas</strong><span>un error rompe la racha</span></article>
      </section>
      <section class="panel">
        <h2>Antes de jugar</h2>
        ${rules}
      </section>
    </main>
  `);

  document.getElementById("start").addEventListener("click", startGame);
  document.getElementById("mute").addEventListener("click", toggleMute);
}

function dotsMarkup() {
  return state.questions.map((_, index) => {
    const entry = state.log[index];
    let cls = "dot";
    if (entry) cls += entry.ok ? " is-ok" : " is-bad";
    else if (index === state.index) cls += " is-now";
    return `<li class="${cls}"></li>`;
  }).join("");
}

function renderPlay() {
  const question = state.questions[state.index];
  const nextMultiplier = Math.min(state.streak + 1, 4);
  const stack = question.options.some((option) => option.label.length > 24);
  const lines = question.lines.map((line) => `<p class="eq">${esc(line)}</p>`).join("");
  const choices = question.options.map((option, index) => {
    const math = /[<>≤≥=]/.test(option.label);
    const long = option.label.length > 16;
    const classes = ["choice", math ? "is-math" : "", long && math ? "is-long" : ""].filter(Boolean).join(" ");
    return `<button type="button" class="${classes}" data-i="${index}"><span class="key">${index + 1}</span>${esc(option.label)}</button>`;
  }).join("");

  mount(`
    <main class="shell">
      <header class="hud">
        <span class="mark">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M16 3 L5 11 L16 19" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>
          Desigual
        </span>
        <div class="hud-metrics">
          <div class="metric"><span>Puntaje</span><strong id="score">${state.score}</strong></div>
          <div class="metric"><span>Racha</span><strong id="streak">${state.streak}</strong></div>
          <div class="lives" id="lives" aria-label="${livesLabel(state.lives)}">${[0, 1, 2].map((i) => heart(i < state.lives)).join("")}</div>
        </div>
        <button type="button" class="ghost" id="quit">Salir</button>
      </header>
      <div class="timer">
        <div class="timer-track"><div id="timebar" class="timer-bar"></div></div>
        <span id="timelabel" class="timelabel">${Math.ceil(state.left / 10)}s</span>
      </div>
      <ol class="dots" id="dots">${dotsMarkup()}</ol>
      <article class="card" id="card">
        <p class="pill">${esc(question.tag)}</p>
        ${lines}
        ${question.note ? `<p class="note">${esc(question.note)}</p>` : ""}
        <p class="lead">${esc(question.lead)}</p>
        <p class="stake">Este acierto vale ×${nextMultiplier}, más el tiempo que sobre.</p>
        <div class="choices${stack ? " is-stack" : ""}" id="choices">${choices}</div>
      </article>
      <p class="play-help">Teclas 1 a 4 para responder. Enter para continuar.</p>
      <p class="sr" id="live" aria-live="polite"></p>
    </main>
  `);

  document.getElementById("quit").addEventListener("click", onQuit);
  document.querySelectorAll(".choice").forEach((button) => {
    button.addEventListener("click", () => lockIn(Number(button.dataset.i)));
  });
}

function renderResults() {
  const accuracy = state.answered ? Math.round((state.correct / state.answered) * 100) : 0;
  const endedEarly = state.lives <= 0 && state.answered < TOTAL;
  const perfect = state.correct === TOTAL && state.lives === 3;
  let heading = "Partida terminada";
  if (perfect) heading = "Ronda perfecta";
  else if (endedEarly) heading = "Sin vidas";

  const props = PROP_ORDER.filter((key) => state.stats[key]).map((key) => {
    const item = state.stats[key];
    const width = item.total ? Math.round((item.ok / item.total) * 100) : 0;
    return `
      <div class="prop">
        <span>${esc(PROP_NAME[key])}</span>
        <strong>${item.ok}/${item.total}</strong>
        <div class="meter"><span style="width:${width}%"></span></div>
      </div>
    `;
  }).join("");

  const misses = state.log.filter((entry) => !entry.ok);
  const missHtml = misses.length
    ? `<section class="misses"><h2>Para repasar</h2>${misses.map((entry) => `
        <article class="miss">
          <h3>${esc(entry.tag)}</h3>
          ${entry.lines.map((line) => `<p class="eq">${esc(line)}</p>`).join("")}
          ${entry.note ? `<p>${esc(entry.note)}</p>` : ""}
          <p>Tu respuesta: ${entry.timeout ? "tiempo agotado" : esc(entry.chosen)}</p>
          <p>Correcto: ${esc(entry.correct)}</p>
          <p>${esc(entry.explain)}</p>
        </article>
      `).join("")}</section>`
    : `<p>Respondiste bien cada pregunta de la partida.</p>`;

  mount(`
    <main class="shell">
      <div class="topbar">
        <span class="mark">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M16 3 L5 11 L16 19" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>
          Desigual
        </span>
      </div>
      <p class="kicker">Resultado</p>
      <h1 class="result-title">${esc(heading)}</h1>
      ${state.record ? `<p><span class="stamp">Nuevo récord</span></p>` : ""}
      <p class="result-score">${state.score}</p>
      <p class="summary">${state.correct} de ${state.answered} aciertos · ${accuracy}% · mejor racha ${state.bestStreak}</p>
      ${state.record ? "" : state.previousBest ? `<p>Récord guardado: ${state.previousBest}</p>` : ""}
      <section class="prop-list" aria-label="Aciertos por propiedad">${props}</section>
      ${missHtml}
      <div class="actions">
        <button type="button" class="primary" id="again">Otra partida</button>
        <button type="button" class="ghost" id="home">Inicio</button>
      </div>
    </main>
  `);

  document.getElementById("again").addEventListener("click", startGame);
  document.getElementById("home").addEventListener("click", showHome);
}

function showHome() {
  stopTimer();
  state.screen = "home";
  renderHome();
}

function startGame() {
  ensureAudio();
  if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume();
  fallbackCount = 0;
  state.screen = "play";
  state.questions = buildRound();
  state.index = 0;
  state.score = 0;
  state.lives = 3;
  state.streak = 0;
  state.bestStreak = 0;
  state.correct = 0;
  state.answered = 0;
  state.locked = false;
  state.log = [];
  state.stats = {};
  state.record = false;
  ask();
}

function ask() {
  stopTimer();
  state.locked = false;
  state.left = TIME_DS;
  renderPlay();
  state.timer = setInterval(tick, 100);
}

function tick() {
  state.left -= 1;
  const bar = document.getElementById("timebar");
  const label = document.getElementById("timelabel");
  if (!bar || !label) {
    stopTimer();
    return;
  }
  const seconds = Math.max(0, Math.ceil(state.left / 10));
  bar.style.width = `${Math.max(0, state.left) / TIME_DS * 100}%`;
  label.textContent = `${seconds}s`;
  const urgent = state.left <= 80;
  bar.classList.toggle("is-urgent", urgent);
  label.classList.toggle("is-urgent", urgent);
  if (state.left <= 0) {
    stopTimer();
    lockIn(null);
  }
}

function bump(property, ok) {
  if (!state.stats[property]) state.stats[property] = { ok: 0, total: 0 };
  state.stats[property].total += 1;
  if (ok) state.stats[property].ok += 1;
}

function lockIn(index) {
  if (state.locked || state.screen !== "play") return;
  state.locked = true;
  stopTimer();

  const question = state.questions[state.index];
  const chosen = index == null ? null : question.options[index];
  const ok = Boolean(chosen && chosen.correct);
  const timeout = index == null;
  let gained = 0;
  let detail = "";

  state.answered += 1;
  if (ok) {
    state.correct += 1;
    state.streak += 1;
    if (state.streak > state.bestStreak) state.bestStreak = state.streak;
    const award = pointsFor(state.streak, state.left);
    gained = award.points;
    state.score += gained;
    detail = `Racha ×${award.multiplier}: ${award.multiplier * 100} puntos, más ${award.speed} de tiempo.`;
    playOk();
  } else {
    state.streak = 0;
    state.lives -= 1;
    playBad();
  }
  bump(question.property, ok);

  const correctOption = question.options.find((option) => option.correct);
  state.log.push({
    tag: question.tag,
    lines: question.lines,
    note: question.note,
    explain: question.explain,
    ok,
    timeout,
    chosen: chosen ? chosen.label : "",
    correct: correctOption.label,
  });

  document.querySelectorAll(".choice").forEach((button, buttonIndex) => {
    button.disabled = true;
    const option = question.options[buttonIndex];
    if (option.correct) button.classList.add("is-right");
    else if (buttonIndex === index) button.classList.add("is-wrong");
    else button.classList.add("is-dim");
  });

  const scoreEl = document.getElementById("score");
  const streakEl = document.getElementById("streak");
  const livesEl = document.getElementById("lives");
  const dots = document.getElementById("dots");
  if (scoreEl) {
    scoreEl.textContent = String(state.score);
    scoreEl.classList.remove("pop");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("pop");
  }
  if (streakEl) streakEl.textContent = String(state.streak);
  if (livesEl) {
    livesEl.innerHTML = [0, 1, 2].map((i) => heart(i < state.lives)).join("");
    livesEl.setAttribute("aria-label", livesLabel(state.lives));
  }
  if (dots) dots.innerHTML = dotsMarkup();

  const lastLife = state.lives <= 0;
  const lastQuestion = state.index + 1 >= state.questions.length;
  const kicker = ok
    ? `Bien · +${gained}`
    : timeout
      ? "Se acabó el tiempo"
      : "Incorrecto";
  const extra = ok
    ? detail
    : lastLife
      ? "Te quedaste sin vidas. La racha volvió a cero."
      : "Pierdes una vida y la racha vuelve a cero.";
  const nextLabel = lastLife || lastQuestion ? "Ver resultado" : "Siguiente";

  const box = document.createElement("div");
  box.className = `feedback ${ok ? "is-ok" : "is-bad"}`;
  box.innerHTML = `
    <h3>${esc(kicker)}</h3>
    <p>${esc(question.explain)}</p>
    <p>${esc(extra)}</p>
    <button type="button" class="primary" id="next">${esc(nextLabel)}</button>
  `;
  document.getElementById("card").appendChild(box);
  document.getElementById("next").addEventListener("click", nextQuestion);
  const live = document.getElementById("live");
  if (live) live.textContent = `${kicker}. ${question.explain}`;
}

function nextQuestion() {
  if (state.screen !== "play" || !state.locked) return;
  state.index += 1;
  if (state.lives <= 0 || state.index >= state.questions.length) finish();
  else ask();
}

function finish() {
  stopTimer();
  state.screen = "result";
  const previous = readBest();
  state.previousBest = previous;
  state.record = state.score > previous && state.score > 0;
  if (state.record) writeBest(state.score);
  renderResults();
}

function toggleMute() {
  audio.muted = !audio.muted;
  writeMute(audio.muted);
  if (state.screen === "home") renderHome();
}

function onQuit(event) {
  const button = event.currentTarget;
  if (button.dataset.armed === "1") {
    showHome();
    return;
  }
  button.dataset.armed = "1";
  button.textContent = "¿Salir?";
}

function onKey(event) {
  if (event.repeat) return;
  if (state.screen === "home" && event.key === "Enter") {
    startGame();
    return;
  }
  if (state.screen !== "play") return;
  if (state.locked) {
    if (event.key === "Enter") {
      event.preventDefault();
      nextQuestion();
    }
    return;
  }
  if (["1", "2", "3", "4"].includes(event.key)) {
    event.preventDefault();
    lockIn(Number(event.key) - 1);
  }
}

function checkProof(question, issues) {
  const proof = question.proof;
  if (!proof) return;
  if (proof.kind === "add") {
    if (proof.newL !== proof.left + proof.delta || proof.newR !== proof.right + proof.delta) {
      issues.push("suma mal calculada");
    }
    if (proof.newSense !== proof.sense) issues.push("la aditiva invirtió el sentido");
  }
  if (proof.kind === "mul") {
    if (proof.newL !== proof.left * proof.factor || proof.newR !== proof.right * proof.factor) {
      issues.push("producto mal calculado");
    }
    const expected = proof.factor < 0 ? flipSense(proof.sense) : proof.sense;
    if (proof.newSense !== expected) issues.push("factor con el sentido equivocado");
  }
  if (proof.kind === "div") {
    if (proof.newL !== proof.left / proof.factor || proof.newR !== proof.right / proof.factor) {
      issues.push("cociente mal calculado");
    }
    const expected = proof.factor < 0 ? flipSense(proof.sense) : proof.sense;
    if (proof.newSense !== expected) issues.push("división con el sentido equivocado");
  }
  if (proof.kind === "add" || proof.kind === "mul" || proof.kind === "div") {
    if (compare(proof.left, proof.right) !== proof.sense) issues.push("sentido inicial");
    if (compare(proof.newL, proof.newR) !== proof.newSense) issues.push("sentido final");
    if (expr(proof.newL, proof.newSense, proof.newR) !== proof.correct) issues.push("texto final");
  }
  if (proof.kind === "sum") {
    if (compare(proof.a + proof.c, proof.b + proof.d) !== proof.sense) issues.push("suma de desigualdades");
    if (proof.correct !== expr(proof.a + proof.c, proof.sense, proof.b + proof.d)) issues.push("etiqueta de suma");
  }
  if (proof.kind === "trans") {
    if (proof.greater) {
      if (!(proof.z > proof.y && proof.y > proof.x)) issues.push("cadena mayor");
      if (proof.correct !== expr(proof.z, ">", proof.x)) issues.push("conclusión mayor");
    } else if (!(proof.x < proof.y && proof.y < proof.z) || proof.correct !== expr(proof.x, "<", proof.z)) {
      issues.push("cadena menor");
    }
  }
}

function desigualAudit(rounds = 60) {
  const issues = [];
  const before = fallbackCount;
  for (let round = 0; round < rounds; round += 1) {
    const questions = buildRound();
    if (questions.length !== TOTAL) issues.push(`largo ${questions.length}`);
    questions.forEach((question) => {
      if (!validChoiceQuestion(question)) issues.push(question && question.family ? question.family : "vacía");
      checkProof(question, issues);
    });
  }
  const usedFallback = fallbackCount - before;
  if (usedFallback) issues.push(`respaldo ${usedFallback}`);
  return { rounds, issueCount: issues.length, sample: issues.slice(0, 8) };
}

if (typeof document !== "undefined") {
  try {
    audio.muted = readMute();
    document.addEventListener("keydown", onKey);
    showHome();
  } catch (error) {
    var app = document.getElementById("app");
    if (app) {
      app.textContent = "No se pudo abrir el juego. Ábrelo con Google Chrome o Microsoft Edge. Detalle: " + error.message;
    }
  }
}

if (typeof window !== "undefined") {
  window.desigualAudit = desigualAudit;
}
