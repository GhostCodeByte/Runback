import { pacingFor } from './analysis';
import type { RunPurpose, RunSummary } from './types';

export const COUPLING_MODEL_VERSION = 'run-strength-coupling-v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const NO_CAUSAL_CLAIM = false as const;

/** Die Frische kommt aus der aufrufenden Schicht, nicht aus diesem Modul. */
export type FreshnessLookup = (regionBase: string, at: number) => number | null;

export interface CoupledRun {
  run: RunSummary;
  regionBase: string;
}

export interface CouplingInput {
  enabled: boolean;
  runs: CoupledRun[];
  purpose?: Extract<RunPurpose, 'easy' | 'long'>;
  freshness?: FreshnessLookup;
  lookup?: FreshnessLookup;
  freshnessLookup?: FreshnessLookup;
}

interface ComparableRun {
  run: RunSummary;
  regionBase: string;
  fadePercent: number;
  legFreshness: number;
  temperatureC: number | null;
}

export interface CaliperPair {
  firstRunId: string;
  secondRunId: string;
  freshnessDifference: number;
  fadeDifferencePercent: number;
}

export interface CouplingRegression {
  interceptFadePercent: number;
  freshnessDeficitCoefficient: number;
  temperatureCoefficient?: number;
  temperatureReferenceC?: number;
  covariates: ('100_minus_leg_freshness' | 'temperatureC')[];
}

export type CouplingAssessment =
  | {
      model_version: string;
      couplingEnabled: false;
      mode: 'separate';
      assessment: 'insufficient_evidence';
      label: 'Verzahnung abgeschaltet';
      summary: string;
      causalClaim: false;
      inputSources: { runId: string; source: string; version: string }[];
      comparableRunIds: string[];
      method: 'separate_evaluation';
      adjustedFadePercent: null;
      regression?: CouplingRegression;
      matchedPairs?: CaliperPair[];
    }
  | {
      model_version: string;
      couplingEnabled: true;
      mode: 'coupled';
      assessment: 'observation';
      label: 'Beobachtung';
      summary: string;
      causalClaim: false;
      inputSources: { runId: string; source: string; version: string }[];
      comparableRunIds: string[];
      method: 'covariate_regression' | 'caliper_matching';
      adjustedFadePercent: number;
      regression?: CouplingRegression;
      matchedPairs?: CaliperPair[];
    }
  | {
      model_version: string;
      couplingEnabled: true;
      mode: 'coupled';
      assessment: 'insufficient_evidence';
      label: 'Nicht ausreichend beurteilbar';
      summary: string;
      causalClaim: false;
      inputSources: { runId: string; source: string; version: string }[];
      comparableRunIds: string[];
      method: 'covariate_regression' | 'caliper_matching' | 'none';
      adjustedFadePercent: null;
      regression?: CouplingRegression;
      matchedPairs?: CaliperPair[];
    };

function lookupFrom(input: {
  freshness?: FreshnessLookup;
  lookup?: FreshnessLookup;
  freshnessLookup?: FreshnessLookup;
}): FreshnessLookup | null {
  return input.freshness ?? input.lookup ?? input.freshnessLookup ?? null;
}

function validFreshness(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100;
}

function purposeFor(input: CouplingInput): Extract<RunPurpose, 'easy' | 'long'> | null {
  if (input.purpose) {
    return input.purpose;
  }
  const first = input.runs.find(entry =>
    entry.run.purpose === 'easy' || entry.run.purpose === 'long',
  );
  return first?.run.purpose === 'easy' || first?.run.purpose === 'long'
    ? first.run.purpose
    : null;
}

function comparableRuns(
  input: CouplingInput,
  lookup: FreshnessLookup,
): ComparableRun[] {
  const purpose = purposeFor(input);
  if (!purpose) {
    return [];
  }
  return input.runs
    .filter(entry => entry.run.purpose === purpose && entry.regionBase.trim())
    .map(entry => {
      const pacing = pacingFor(entry.run);
      const freshness = lookup(entry.regionBase, entry.run.startTime);
      return {
        entry,
        pacing,
        freshness,
      };
    })
    .filter(
      item =>
        item.pacing !== undefined &&
        item.pacing.fadePercent !== undefined &&
        validFreshness(item.freshness),
    )
    .map(item => ({
      run: item.entry.run,
      regionBase: item.entry.regionBase,
      fadePercent: item.pacing!.fadePercent,
      legFreshness: item.freshness as number,
      temperatureC: Number.isFinite(item.entry.run.context?.temperatureC)
        ? (item.entry.run.context?.temperatureC as number)
        : null,
    }))
    .sort((a, b) => a.run.startTime - b.run.startTime || a.run.id.localeCompare(b.run.id));
}

function insufficient(
  summary: string,
  comparableRunIds: string[],
  method: 'covariate_regression' | 'caliper_matching' | 'none',
  inputSources: { runId: string; source: string; version: string }[] = [],
): CouplingAssessment {
  return {
    model_version: COUPLING_MODEL_VERSION,
    couplingEnabled: true,
    mode: 'coupled',
    assessment: 'insufficient_evidence',
    label: 'Nicht ausreichend beurteilbar',
    summary,
    causalClaim: NO_CAUSAL_CLAIM,
    inputSources,
    comparableRunIds,
    method,
    adjustedFadePercent: null,
  };
}

function solveLinearSystem(matrix: number[][], values: number[]): number[] | null {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10) {
      return null;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let j = column; j <= size; j += 1) {
      augmented[column][j] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) {
        continue;
      }
      const factor = augmented[row][column];
      for (let j = column; j <= size; j += 1) {
        augmented[row][j] -= factor * augmented[column][j];
      }
    }
  }
  return augmented.map(row => row[size]);
}

function inputSourcesFor(
  rows: ComparableRun[],
): { runId: string; source: string; version: string }[] {
  return rows.map(row => ({
    runId: row.run.id,
    source: row.run.source,
    version: row.run.sourceVersion ?? 'native-aggregate-v1',
  }));
}

function regressionFor(
  rows: ComparableRun[],
): { regression: CouplingRegression; adjustedFadePercent: number } | null {
  const withTemperature = rows.every(row => row.temperatureC !== null);
  const temperatureReferenceC = withTemperature
    ? rows.reduce((sum, row) => sum + (row.temperatureC as number), 0) / rows.length
    : undefined;
  const design = rows.map(row => {
    const predictors = [1, 100 - row.legFreshness];
    if (withTemperature) {
      predictors.push((row.temperatureC as number) - temperatureReferenceC!);
    }
    return predictors;
  });
  const matrix = design[0].map((_, column) =>
    design[0].map((__, otherColumn) =>
      design.reduce(
        (sum, current) => sum + current[column] * current[otherColumn],
        0,
      ),
    ),
  );
  const values = design[0].map((_, column) =>
    design.reduce(
      (sum, current, index) => sum + current[column] * rows[index].fadePercent,
      0,
    ),
  );
  const coefficients = solveLinearSystem(matrix, values);
  if (!coefficients) {
    return null;
  }
  const regression: CouplingRegression = {
    interceptFadePercent: coefficients[0],
    freshnessDeficitCoefficient: coefficients[1],
    covariates: withTemperature
      ? ['100_minus_leg_freshness', 'temperatureC']
      : ['100_minus_leg_freshness'],
  };
  if (withTemperature) {
    regression.temperatureCoefficient = coefficients[2];
    regression.temperatureReferenceC = temperatureReferenceC;
  }
  return {
    regression,
    adjustedFadePercent: coefficients[0],
  };
}

function caliperFor(rows: ComparableRun[]): CaliperPair[] {
  const pairs: CaliperPair[] = [];
  for (let first = 0; first < rows.length; first += 1) {
    for (let second = first + 1; second < rows.length; second += 1) {
      const freshnessDifference = Math.abs(
        rows[first].legFreshness - rows[second].legFreshness,
      );
      if (freshnessDifference <= 10) {
        pairs.push({
          firstRunId: rows[first].run.id,
          secondRunId: rows[second].run.id,
          freshnessDifference,
          fadeDifferencePercent:
            rows[first].fadePercent - rows[second].fadePercent,
        });
      }
    }
  }
  return pairs;
}

/**
 * Bewertet den Zusammenhang nur als Vergleich. Die Zahl ist eine Beobachtung,
 * niemals ein Ursachennachweis.
 */
export function evaluateCoupling(input: CouplingInput): CouplingAssessment {
  if (!input.enabled) {
    return {
      model_version: COUPLING_MODEL_VERSION,
      couplingEnabled: false,
      mode: 'separate',
      assessment: 'insufficient_evidence',
      label: 'Verzahnung abgeschaltet',
      summary:
        'Die Verzahnung ist abgeschaltet. Laufen und Krafttraining bleiben getrennt bewertet; es wird keine Kopplungszahl erzeugt.',
      causalClaim: NO_CAUSAL_CLAIM,
      inputSources: [],
      comparableRunIds: [],
      method: 'separate_evaluation',
      adjustedFadePercent: null,
    };
  }
  const lookup = lookupFrom(input);
  if (!lookup) {
    return insufficient(
      'Noch nicht ausreichend beurteilbar: Eine Frischequelle wurde nicht injiziert.',
      [],
      'none',
    );
  }
  const rows = comparableRuns(input, lookup);
  const comparableRunIds = rows.map(row => row.run.id);
  if (rows.length >= 10) {
    const fit = regressionFor(rows);
    if (!fit) {
      return insufficient(
        'Noch nicht ausreichend beurteilbar: Die Frischewerte tragen keine eigenständige kleine Regression.',
        comparableRunIds,
        'covariate_regression',
        inputSourcesFor(rows),
      );
    }
    return {
      model_version: COUPLING_MODEL_VERSION,
      couplingEnabled: true,
      mode: 'coupled',
      assessment: 'observation',
      label: 'Beobachtung',
      summary:
        'Beobachtung aus einer kleinen Regression des Lauf-Nachlassens auf 100 minus Beinfrische und höchstens einer weiteren Kovariate; kein Ursachennachweis.',
      causalClaim: NO_CAUSAL_CLAIM,
      inputSources: inputSourcesFor(rows),
      comparableRunIds,
      method: 'covariate_regression',
      adjustedFadePercent: fit.adjustedFadePercent,
      regression: fit.regression,
    };
  }
  const matchedPairs = caliperFor(rows);
  if (!matchedPairs.length) {
    return insufficient(
      'Noch nicht ausreichend beurteilbar: Unter zehn vergleichbaren Läufen gibt es kein Frischepaar im Caliper von höchstens 10 Punkten.',
      comparableRunIds,
      'caliper_matching',
      inputSourcesFor(rows),
    );
  }
  const adjustedFadePercent =
    matchedPairs.reduce((sum, pair) => sum + pair.fadeDifferencePercent, 0) /
    matchedPairs.length;
  return {
    model_version: COUPLING_MODEL_VERSION,
    couplingEnabled: true,
    mode: 'coupled',
    assessment: 'observation',
    label: 'Beobachtung',
    summary:
      'Beobachtung aus Caliper-Vergleichen mit höchstens 10 Punkten Frischeunterschied; der Unterschied ist kein Ursachennachweis.',
    causalClaim: NO_CAUSAL_CLAIM,
    inputSources: inputSourcesFor(rows),
    comparableRunIds,
    method: 'caliper_matching',
    adjustedFadePercent,
    matchedPairs,
  };
}

export const evaluateRunCoupling = evaluateCoupling;

export interface PlannedSession {
  id: string;
  kind: 'run' | 'strength';
  at: number;
  regionBases: string[];
  important?: boolean;
}

export interface PlannedFreshness {
  sessionId: string;
  kind: PlannedSession['kind'];
  at: number;
  regionFreshness: Record<string, number | null>;
  minimumFreshness: number | null;
  unknownRegionBases: string[];
  assessment: 'observation' | 'insufficient_evidence';
}

/** Bewertet geplante Termine, ohne eine Frischeformel zu duplizieren. */
export function simulatePlannedFreshness(
  sessions: PlannedSession[],
  lookup: FreshnessLookup,
): PlannedFreshness[] {
  return [...sessions]
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .map(session => {
      const regionFreshness: Record<string, number | null> = {};
      const unknownRegionBases: string[] = [];
      for (const regionBase of [...new Set(session.regionBases)].sort()) {
        const value = lookup(regionBase, session.at);
        regionFreshness[regionBase] = validFreshness(value) ? value : null;
        if (!validFreshness(value)) {
          unknownRegionBases.push(regionBase);
        }
      }
      const values = Object.values(regionFreshness).filter(
        (value): value is number => value !== null,
      );
      const complete =
        session.regionBases.length > 0 &&
        unknownRegionBases.length === 0 &&
        values.length > 0;
      return {
        sessionId: session.id,
        kind: session.kind,
        at: session.at,
        regionFreshness,
        minimumFreshness: complete ? Math.min(...values) : null,
        unknownRegionBases,
        assessment: complete ? 'observation' : 'insufficient_evidence',
      };
    });
}

export const forwardSimulateFreshness = simulatePlannedFreshness;

export interface MonthlyPlanSession {
  id: string;
  kind: PlannedSession['kind'];
  regionBases: string[];
  important: boolean;
  fixedWeekday?: number;
  existingWeekday?: number;
  timeOfDayMs?: number;
}

export interface MonthlyPlanInput {
  enabled: boolean;
  sessions: MonthlyPlanSession[];
  weekStartAt: number;
  weeks?: number;
  freshness?: FreshnessLookup;
  lookup?: FreshnessLookup;
  freshnessLookup?: FreshnessLookup;
}

export interface PlanAssignment {
  sessionId: string;
  weekday: number;
}

export interface MonthlyPlanSuggestion {
  reason: string;
  targetRange: { assignments: PlanAssignment[] };
  expectedEffort: { text: string };
  checkCriterion: {
    method: 'monthly-freshness-v1';
    reviewAfterWeeks: number;
    check: string;
  };
}

export interface MonthlyPlanSearchResult {
  model_version: string;
  couplingEnabled: boolean;
  mode: 'coupled' | 'separate';
  assessment: 'observation' | 'insufficient_evidence';
  verdict: 'change_plan' | 'keep_plan' | 'not_assessable';
  selected: {
    assignments: PlanAssignment[];
    minimumImportantFreshness: number;
    deviationFromExistingPlan: number;
  } | null;
  suggestion: MonthlyPlanSuggestion | null;
  reason: string;
  causalClaim: false;
}

function validWeekday(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 0 && value <= 6;
}

function insufficientPlan(
  enabled: boolean,
  reason: string,
): MonthlyPlanSearchResult {
  return {
    model_version: COUPLING_MODEL_VERSION,
    couplingEnabled: enabled,
    mode: enabled ? 'coupled' : 'separate',
    assessment: 'insufficient_evidence',
    verdict: 'not_assessable',
    selected: null,
    suggestion: null,
    reason,
    causalClaim: NO_CAUSAL_CLAIM,
  };
}

/** Vollständige, deterministische Suche über wenige Wochentagszuweisungen. */
export function searchMonthlyPlan(
  input: MonthlyPlanInput,
): MonthlyPlanSearchResult {
  if (!input.enabled) {
    return insufficientPlan(
      false,
      'Die Verzahnung ist abgeschaltet; beide Trainingsarten bleiben getrennt und es wird kein gekoppelter Plan vorgeschlagen.',
    );
  }
  const lookup = lookupFrom(input);
  const weeks = Math.floor(input.weeks ?? 4);
  if (!lookup) {
    return insufficientPlan(
      true,
      'Noch nicht ausreichend beurteilbar: Eine Frischequelle wurde nicht injiziert.',
    );
  }
  if (
    !Number.isFinite(input.weekStartAt) ||
    weeks < 1 ||
    weeks > 5 ||
    input.sessions.length === 0 ||
    input.sessions.length > 6 ||
    input.sessions.some(
      session =>
        !session.id ||
        !session.regionBases.length ||
        (session.fixedWeekday !== undefined &&
          !validWeekday(session.fixedWeekday)),
    )
  ) {
    return insufficientPlan(
      true,
      'Noch nicht ausreichend beurteilbar: Der monatliche Suchraum ist leer, zu groß oder enthält einen ungültigen Fixtermin.',
    );
  }
  if (!input.sessions.some(session => session.important)) {
    return insufficientPlan(
      true,
      'Noch nicht ausreichend beurteilbar: Es ist keine wichtige Einheit markiert.',
    );
  }
  const sessions = [...input.sessions].sort((a, b) => a.id.localeCompare(b.id));
  let best:
    | {
        assignments: PlanAssignment[];
        minimumImportantFreshness: number;
        deviationFromExistingPlan: number;
      }
    | undefined;

  const evaluate = (assignments: PlanAssignment[]) => {
    const assignmentById = new Map(
      assignments.map(assignment => [assignment.sessionId, assignment.weekday]),
    );
    const planned: PlannedSession[] = [];
    for (let week = 0; week < weeks; week += 1) {
      for (const session of sessions) {
        const weekday = assignmentById.get(session.id)!;
        planned.push({
          id: `${session.id}-w${week}`,
          kind: session.kind,
          at:
            input.weekStartAt +
            week * 7 * DAY_MS +
            weekday * DAY_MS +
            (session.timeOfDayMs ?? 12 * 60 * 60 * 1000),
          regionBases: session.regionBases,
          important: session.important,
        });
      }
    }
    const simulated = simulatePlannedFreshness(planned, lookup);
    const importantValues = simulated
      .filter(item => planned.find(session => session.id === item.sessionId)?.important)
      .map(item => item.minimumFreshness);
    if (
      importantValues.length === 0 ||
      importantValues.some((value): value is null => value === null)
    ) {
      return;
    }
    const minimumImportantFreshness = Math.min(
      ...(importantValues as number[]),
    );
    const deviationFromExistingPlan = sessions.reduce((sum, session) => {
      const existing = validWeekday(session.existingWeekday)
        ? session.existingWeekday
        : validWeekday(session.fixedWeekday)
        ? session.fixedWeekday
        : 0;
      return sum + Math.abs(assignmentById.get(session.id)! - existing);
    }, 0);
    const key = assignments.map(assignment => `${assignment.sessionId}:${assignment.weekday}`).join('|');
    const bestKey = best
      ? best.assignments
          .map(assignment => `${assignment.sessionId}:${assignment.weekday}`)
          .join('|')
      : '';
    if (
      !best ||
      minimumImportantFreshness > best.minimumImportantFreshness + 1e-9 ||
      (Math.abs(minimumImportantFreshness - best.minimumImportantFreshness) <= 1e-9 &&
        (deviationFromExistingPlan < best.deviationFromExistingPlan ||
          (deviationFromExistingPlan === best.deviationFromExistingPlan && key < bestKey)))
    ) {
      best = {
        assignments: assignments.map(assignment => ({ ...assignment })),
        minimumImportantFreshness,
        deviationFromExistingPlan,
      };
    }
  };

  const enumerate = (index: number, assignments: PlanAssignment[]) => {
    if (index === sessions.length) {
      evaluate(assignments);
      return;
    }
    const session = sessions[index];
    const weekdays = validWeekday(session.fixedWeekday)
      ? [session.fixedWeekday]
      : [0, 1, 2, 3, 4, 5, 6];
    for (const weekday of weekdays) {
      enumerate(index + 1, [
        ...assignments,
        { sessionId: session.id, weekday },
      ]);
    }
  };
  enumerate(0, []);
  if (!best) {
    return insufficientPlan(
      true,
      'Noch nicht ausreichend beurteilbar: Für keine vollständige Tageszuordnung ist die wichtige Frische vollständig bekannt.',
    );
  }
  const existing = sessions.map(session => ({
    sessionId: session.id,
    weekday: validWeekday(session.existingWeekday)
      ? session.existingWeekday
      : validWeekday(session.fixedWeekday)
      ? session.fixedWeekday
      : 0,
  }));
  const changed = best.assignments.some(
    (assignment, index) => assignment.weekday !== existing[index].weekday,
  );
  return {
    model_version: COUPLING_MODEL_VERSION,
    couplingEnabled: true,
    mode: 'coupled',
    assessment: 'observation',
    verdict: changed ? 'change_plan' : 'keep_plan',
    selected: best,
    suggestion: changed
      ? {
          reason:
            'Die vollständige Suche schützt die minimale vorhergesagte Frische wichtiger Einheiten und weicht bei Gleichstand möglichst wenig vom bestehenden Plan ab.',
          targetRange: { assignments: best.assignments },
          expectedEffort: {
            text: 'Planänderung als kleiner, einzelner Versuch; Trainingszweck und Umfang bleiben erhalten.',
          },
          checkCriterion: {
            method: 'monthly-freshness-v1',
            reviewAfterWeeks: weeks,
            check:
              'Nach dem Planzeitraum prüfen, ob wichtige Einheiten wie geplant stattfanden und die vorhergesagte Frische nicht durch fehlende Daten ersetzt werden musste.',
          },
        }
      : null,
    reason: changed
      ? 'Beobachtung mit prüfbarer einzelner Planänderung; kein Ursachennachweis.'
      : 'Beobachtung: Der bestehende Plan ist nach der vollständigen Suche bereits der passende Plan.',
    causalClaim: NO_CAUSAL_CLAIM,
  };
}

export const monthlyPlanSearch = searchMonthlyPlan;
export const planMonthly = searchMonthlyPlan;
