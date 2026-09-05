/* Golden-value tests for the calculator.
 *
 * Run:  node --test tests/
 *
 * These exist because the arithmetic used to ship unchecked. The protein
 * formula was once a made-up constant, and the only thing standing between a
 * wrong number and a visitor was a dietitian reading the page by eye. If a
 * formula changes, one of these fails and the build stops.
 *
 * Expected values are worked by hand in the comments so a future reader can
 * see WHY a number is right, not just that it matched last time.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/protein-math.js');

const close = (a, b, tol = 0.5) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ~${b}, got ${a}`);

/* ---------------------------------------------------------------- units */

test('pounds and feet convert to metric', () => {
  const m = M.toMetric({ unit: 'imperial', lbs: 220, ft: 5, inch: 10 });
  close(m.weightKg, 99.79);          // 220 × 0.453592
  close(m.heightCm, 177.8);          // (5×12 + 10) × 2.54
});

test('metric passes through untouched', () => {
  const m = M.toMetric({ unit: 'metric', kg: 100, cm: 178 });
  assert.equal(m.weightKg, 100);
  assert.equal(m.heightCm, 178);
});

test('missing inches are treated as zero, not NaN', () => {
  const m = M.toMetric({ unit: 'imperial', lbs: 180, ft: 6 });
  close(m.heightCm, 182.88);
  assert.ok(!Number.isNaN(m.heightCm));
});

/* ------------------------------------------------------- ideal weight */

test('Devine IBW at exactly five feet is the base figure', () => {
  close(M.idealBodyWeightKg('male', 152.4), 50);     // 5'0"
  close(M.idealBodyWeightKg('female', 152.4), 45.5);
});

test('Devine IBW adds 2.3 kg per inch over five feet', () => {
  close(M.idealBodyWeightKg('male', 177.8), 73);     // 50 + 2.3×10
  close(M.idealBodyWeightKg('female', 165.1), 57);   // 5'5" = 5in over: 45.5 + 2.3×5
});

test('Devine IBW never goes below the base for short heights', () => {
  assert.equal(M.idealBodyWeightKg('male', 140), 50);
});

/* -------------------------------------------------------- multiplier */

test('sedentary adult sits mid-range at 1.4', () => {
  assert.equal(M.proteinMultiplier({ activity: 1.2, age: 40, phase: 'maintenance' }), 1.4);
});

test('active raises it to 1.7', () => {
  assert.equal(M.proteinMultiplier({ activity: 1.55, age: 40, phase: 'maintenance' }), 1.7);
});

test('over 65 lifts a sedentary adult to 1.5 but does not lower an active one', () => {
  assert.equal(M.proteinMultiplier({ activity: 1.2, age: 70, phase: 'maintenance' }), 1.5);
  assert.equal(M.proteinMultiplier({ activity: 1.55, age: 70, phase: 'maintenance' }), 1.7);
});

test('titration adds 0.1', () => {
  const a = M.proteinMultiplier({ activity: 1.2, age: 40, phase: 'maintenance' });
  const b = M.proteinMultiplier({ activity: 1.2, age: 40, phase: 'titration' });
  close(b - a, 0.1, 1e-9);
});

test('the multiplier is capped at 2.0', () => {
  const m = M.proteinMultiplier({ activity: 1.9, age: 80, phase: 'titration' });
  assert.ok(m <= 2.0, `capped, got ${m}`);
});

/* ------------------------------------------------------------ protein */

test('5ft10 220lb 45yo sedentary male in maintenance', () => {
  // IBW 73 kg, actual 99.8 kg -> basis is IBW. 73 × 1.4 = 102.2 -> 102 g
  const p = M.protein({ sex: 'male', age: 45, weightKg: 99.79, heightCm: 177.8,
                        activity: 1.2, phase: 'maintenance' });
  assert.equal(p.grams, 102);
  assert.equal(p.basisIsIdeal, true);
  assert.equal(p.perMeal, 34);
  assert.equal(p.perSnack, 17);
});

test('someone BELOW ideal weight is dosed on actual, never on ideal', () => {
  // 60 kg actual against a 73 kg ideal: basis must be 60, or we overshoot.
  const p = M.protein({ sex: 'male', age: 30, weightKg: 60, heightCm: 177.8,
                        activity: 1.2, phase: 'maintenance' });
  assert.equal(p.basisIsIdeal, false);
  assert.equal(p.grams, Math.round(60 * 1.4));   // 84
});

test('titration raises the target above maintenance for the same person', () => {
  const base = { sex: 'female', age: 50, weightKg: 85, heightCm: 165.1, activity: 1.2 };
  const maint = M.protein({ ...base, phase: 'maintenance' });
  const titr  = M.protein({ ...base, phase: 'titration' });
  assert.ok(titr.grams > maint.grams, `${titr.grams} should exceed ${maint.grams}`);
});

/* ------------------------------------------------------------- energy */

test('Mifflin-St Jeor for a 5ft10 220lb 45yo male', () => {
  // 10×99.79 + 6.25×177.8 - 5×45 + 5 = 997.9 + 1111.25 - 225 + 5 = 1889.15
  close(M.bmr({ sex: 'male', age: 45, weightKg: 99.79, heightCm: 177.8 }), 1889.15, 1);
});

test('Mifflin-St Jeor female offset is -161, a 166 kcal gap from male', () => {
  const same = { age: 45, weightKg: 99.79, heightCm: 177.8 };
  const diff = M.bmr({ ...same, sex: 'male' }) - M.bmr({ ...same, sex: 'female' });
  close(diff, 166, 1e-9);
});

test('BMR is NOT the old made-up constant', () => {
  // The formula was once 10*kg + 1300. Guard against it coming back.
  const kg = 99.79;
  const real = M.bmr({ sex: 'male', age: 45, weightKg: kg, heightCm: 177.8 });
  assert.notEqual(Math.round(real), Math.round(10 * kg + 1300));
});

test('calorie target sits below TDEE, and titration cuts deeper', () => {
  const base = { sex: 'male', age: 45, weightKg: 99.79, heightCm: 177.8, activity: 1.2 };
  const maint = M.energy({ ...base, phase: 'maintenance' });
  const titr  = M.energy({ ...base, phase: 'titration' });
  assert.ok(maint.calorieTarget < maint.tdee);
  assert.ok(titr.calorieTarget < maint.calorieTarget);
});

test('the calorie floor is never breached', () => {
  // A very small person: 65% of TDEE would fall under the floor.
  const f = M.energy({ sex: 'female', age: 80, weightKg: 40, heightCm: 150,
                       activity: 1.2, phase: 'titration' });
  assert.ok(f.minCalories >= 1200, `female floor, got ${f.minCalories}`);
  const m = M.energy({ sex: 'male', age: 80, weightKg: 50, heightCm: 160,
                       activity: 1.2, phase: 'titration' });
  assert.ok(m.minCalories >= 1500, `male floor, got ${m.minCalories}`);
});

/* --------------------------------------------------------- validation */

test('out-of-range input is rejected rather than silently computed', () => {
  assert.ok(M.validate({ age: 9,  unit: 'metric', kg: 80, cm: 170 }));
  assert.ok(M.validate({ age: 45, unit: 'metric', kg: 5,  cm: 170 }));
  assert.ok(M.validate({ age: 45, unit: 'metric', kg: 80, cm: 30  }));
  assert.ok(M.validate({ age: 45, unit: 'imperial', lbs: 20, ft: 5 }));
  assert.equal(M.validate({ age: 45, unit: 'metric', kg: 80, cm: 170 }), null);
});

test('no reachable input produces NaN or a negative target', () => {
  for (const sex of ['male', 'female']) {
    for (const age of [15, 45, 100]) {
      for (const kg of [25, 100, 320]) {
        for (const cm of [90, 175, 250]) {
          for (const activity of [1.2, 1.375, 1.55, 1.725, 1.9]) {
            for (const phase of ['titration', 'maintenance']) {
              const o = { sex, age, weightKg: kg, heightCm: cm, activity, phase };
              const p = M.protein(o), e = M.energy(o);
              assert.ok(Number.isFinite(p.grams) && p.grams > 0, `protein ${JSON.stringify(o)}`);
              assert.ok(Number.isFinite(e.calorieTarget) && e.calorieTarget > 0, `cals ${JSON.stringify(o)}`);
            }
          }
        }
      }
    }
  }
});

/* ------------------------------------------------- serving percentages */

test('a serving percentage matches what the product block prints', () => {
  assert.equal(M.percentOfTarget(30, 102), 29);   // Premier Protein
  assert.equal(M.percentOfTarget(26, 102), 25);   // Fairlife Core Power
  assert.equal(M.percentOfTarget(25, 102), 25);   // whey scoop
  assert.equal(M.percentOfTarget(20, 102), 20);   // Quest bar
});

test('a zero target does not divide by zero', () => {
  assert.equal(M.percentOfTarget(30, 0), 0);
});
