/* Protein and energy maths for the GLP-1 calculator.
 *
 * Pulled out of the page so it can be tested. Every function here is pure:
 * numbers in, numbers out, no DOM. That is the whole point — the arithmetic
 * had been shipping unverified, and a dietitian was catching the mistakes by
 * eye. A machine should catch arithmetic; she should be reviewing judgement.
 *
 * Loads as a browser global (ProteinMath) or a Node module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProteinMath = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LB_TO_KG = 0.453592;
  var IN_TO_CM = 2.54;

  var LIMITS = {
    age:  { min: 15,  max: 100 },
    lbs:  { min: 50,  max: 700 },
    ft:   { min: 3,   max: 8   },
    kg:   { min: 25,  max: 320 },
    cm:   { min: 90,  max: 250 }
  };

  /* Normalise whatever the form gave us to metric. */
  function toMetric(input) {
    if (input.unit === 'imperial') {
      return {
        weightKg: input.lbs * LB_TO_KG,
        heightCm: (input.ft * 12 + (input.inch || 0)) * IN_TO_CM
      };
    }
    return { weightKg: input.kg, heightCm: input.cm };
  }

  /* Returns an error string, or null when the input is usable. */
  function validate(input) {
    var a = input.age;
    if (!a || a < LIMITS.age.min || a > LIMITS.age.max) {
      return 'Please enter a valid age (' + LIMITS.age.min + '-' + LIMITS.age.max + ')';
    }
    if (input.unit === 'imperial') {
      if (!input.lbs || input.lbs < LIMITS.lbs.min || input.lbs > LIMITS.lbs.max) {
        return 'Please enter a valid weight (50-700 lbs)';
      }
      if (!input.ft || input.ft < LIMITS.ft.min || input.ft > LIMITS.ft.max) {
        return 'Please enter a valid height (3-8 ft)';
      }
    } else {
      if (!input.kg || input.kg < LIMITS.kg.min || input.kg > LIMITS.kg.max) {
        return 'Please enter a valid weight (25-320 kg)';
      }
      if (!input.cm || input.cm < LIMITS.cm.min || input.cm > LIMITS.cm.max) {
        return 'Please enter a valid height (90-250 cm)';
      }
    }
    return null;
  }

  /* Devine ideal body weight. Base plus 2.3 kg for every inch over five feet. */
  function idealBodyWeightKg(sex, heightCm) {
    var inchesOver5ft = Math.max(0, heightCm / IN_TO_CM - 60);
    return (sex === 'male' ? 50 : 45.5) + 2.3 * inchesOver5ft;
  }

  /* g of protein per kg. Published range is 1.2-1.6 for weight loss; active
     people and over-65s sit higher, titration adds a little, capped at 2.0. */
  function proteinMultiplier(opts) {
    var m = 1.4;
    if (opts.activity >= 1.55) m = 1.7;
    if (opts.age >= 65) m = Math.max(m, 1.5);
    if (opts.phase === 'titration') m += 0.1;
    return Math.min(m, 2.0);
  }

  /* Mifflin-St Jeor, on ACTUAL weight, which is what the equation is defined on. */
  function bmr(opts) {
    return 10 * opts.weightKg + 6.25 * opts.heightCm - 5 * opts.age
         + (opts.sex === 'male' ? 5 : -161);
  }

  /* Protein is dosed on ideal body weight, or actual when that is lower, so a
     visitor above their ideal weight is never told to eat more than they need. */
  function protein(opts) {
    var idealKg = idealBodyWeightKg(opts.sex, opts.heightCm);
    var basisKg = Math.min(opts.weightKg, idealKg);
    var mult = proteinMultiplier(opts);
    var grams = Math.round(basisKg * mult);
    return {
      idealKg: idealKg,
      basisKg: basisKg,
      basisIsIdeal: basisKg === idealKg,
      multiplier: mult,
      grams: grams,
      perMeal: Math.round(grams / 3),
      perSnack: Math.round(grams / 6)
    };
  }

  function energy(opts) {
    var b = bmr(opts);
    var tdee = Math.round(b * opts.activity);
    var reduction = opts.phase === 'titration' ? 0.80 : 0.85;
    var floor = opts.sex === 'male' ? 1500 : 1200;
    return {
      bmr: b,
      tdee: tdee,
      calorieTarget: Math.round(tdee * reduction),
      minCalories: Math.max(floor, Math.round(tdee * 0.65))
    };
  }

  /* What one serving covers of the day's target, as a whole percent. */
  function percentOfTarget(grams, target) {
    if (!target) return 0;
    return Math.round((grams / target) * 100);
  }

  return {
    LB_TO_KG: LB_TO_KG, IN_TO_CM: IN_TO_CM, LIMITS: LIMITS,
    toMetric: toMetric, validate: validate,
    idealBodyWeightKg: idealBodyWeightKg, proteinMultiplier: proteinMultiplier,
    bmr: bmr, protein: protein, energy: energy, percentOfTarget: percentOfTarget
  };
}));
