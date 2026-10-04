/* StackSense prototype: scripted content for Maya's path.
 * Everything a designer would hard-code lives here: body areas, signals,
 * question cards (with Maya's answers), supplements, products and medicines.
 * The engine (engine.js) turns answers into signals, a stack and a calendar. */
(function (SS) {
  'use strict';

  SS.PERSONA = {
    name: 'Maya', age: 34, sex: 'female', city: 'Toronto', lat: '43.7° N', month: 'October',
    work: 'Product designer, remote, 9+ hours at a screen'
  };

  /* Plan start and the date the prototype treats as "today" in the calendar. */
  SS.PLAN_START = new Date(2026, 9, 5);   // Mon 5 Oct 2026
  SS.DEMO_TODAY = new Date(2026, 9, 19);  // Mon 19 Oct 2026, day 15, full stack on

  SS.AMAZON_TAG = 'stacksense0c-20';
  SS.amazon = function (q) {
    return 'https://www.amazon.ca/s?k=' + encodeURIComponent(q).replace(/%20/g, '+') + '&tag=' + SS.AMAZON_TAG;
  };

  /* ------------------------------------------------------------------ */
  /* Body areas: one colour per area, used in every chart, card and dot. */
  SS.AREAS = [
    { id: 'sleep', name: 'Sleep', short: 'Sleep', color: '#5560C9', icon: 'moon' },
    { id: 'energy', name: 'Energy', short: 'Energy', color: '#B98A12', icon: 'bolt' },
    { id: 'joints', name: 'Joints & recovery', short: 'Joints', color: '#1F9AA6', icon: 'joint' },
    { id: 'mood', name: 'Mood & stress', short: 'Mood', color: '#9259BF', icon: 'smile' },
    { id: 'performance', name: 'Performance', short: 'Perform.', color: '#E07A1F', icon: 'run' },
    { id: 'skin', name: 'Skin & hair', short: 'Skin & hair', color: '#C24E8C', icon: 'drop' },
    { id: 'immunity', name: 'Immunity', short: 'Immunity', color: '#6FA23A', icon: 'shield' },
    { id: 'heart', name: 'Heart & metabolic', short: 'Heart', color: '#A8323A', icon: 'heart' }
  ];
  SS.AREA = {};
  SS.AREAS.forEach(function (a) { SS.AREA[a.id] = a; });

  /* "When you might notice" strip on the Health Impact Map. */
  SS.NOTICE_TIMES = [
    { area: 'sleep', label: 'Sleep', range: '1–3 weeks' },
    { area: 'mood', label: 'Stress', range: '4–8 weeks' },
    { area: 'performance', label: 'Performance', range: '3–4 weeks' },
    { area: 'immunity', label: 'Vitamin D status', range: '8–12 weeks' }
  ];

  /* ------------------------------------------------------------------ */
  /* Signals. Labels for the review screen, short tags for the insight rail. */
  SS.SIGNAL_META = {
    sleep_onset: { label: 'Slow to fall asleep', tag: 'Sleep onset', area: 'sleep' },
    caffeine_late: { label: 'Late caffeine', tag: 'Late caffeine', area: 'sleep' },
    stress_arousal: { label: 'Racing mind at night', tag: 'Racing mind', area: 'mood' },
    stress_moderate: { label: 'Moderate stress', tag: 'Moderate stress', area: 'mood' },
    afternoon_crash: { label: 'Afternoon energy crash', tag: 'Afternoon crash', area: 'energy' },
    low_iron_risk: { label: 'Possible low iron', tag: 'Possible low iron', area: 'energy' },
    b12_risk: { label: 'Low B12 intake', tag: 'B12 gap', area: 'energy' },
    exercise_soreness: { label: 'Knee soreness after long runs', tag: 'Exercise soreness', area: 'joints' },
    endurance_load: { label: 'Endurance training load', tag: 'Training load', area: 'performance' },
    low_dietary_creatine: { label: 'Low dietary creatine', tag: 'Creatine gap', area: 'performance' },
    hair_shedding: { label: 'More hair shedding', tag: 'Hair shedding', area: 'skin' },
    vitamin_d_risk: { label: 'Little daylight', tag: 'Vitamin D risk', area: 'immunity' },
    omega3_gap: { label: 'Low omega-3 intake', tag: 'Omega-3 gap', area: 'heart' },
    med_contraceptive: { label: 'Hormonal contraceptive', tag: 'On the pill', area: null }
  };

  /* How much "need" each signal adds to an area (0–10 scale). Goals add
   * 2.5 x their rank weight (1.0 / 0.8 / 0.6) on top. Maya's totals:
   * Sleep 8 · Energy 7 · Joints 6 · Mood 6 · Performance 5 · Skin 5 · Immunity 3 · Heart 2. */
  SS.NEED_RULES = [
    { sig: 'sleep_onset', area: 'sleep', v: 3.5 },
    { sig: 'stress_arousal', area: 'sleep', v: 2 },
    { sig: 'afternoon_crash', area: 'energy', v: 3 },
    { sig: 'low_iron_risk', area: 'energy', v: 2 },
    { sig: 'exercise_soreness', area: 'joints', v: 3 },
    { sig: 'endurance_load', area: 'joints', v: 1.5 },
    { sig: 'stress_moderate', area: 'mood', v: 4 },
    { sig: 'stress_arousal', area: 'mood', v: 2 },
    { sig: 'endurance_load', area: 'performance', v: 3 },
    { sig: 'low_dietary_creatine', area: 'performance', v: 2 },
    { sig: 'hair_shedding', area: 'skin', v: 3 },
    { sig: 'low_iron_risk', area: 'skin', v: 2 },
    { sig: 'vitamin_d_risk', area: 'immunity', v: 3 },
    { sig: 'omega3_gap', area: 'heart', v: 2 }
  ];
  SS.GOAL_AREA = { sleep: 'sleep', energy: 'energy', joints: 'joints', mood: 'mood', focus: 'mood', performance: 'performance', skin: 'skin', immunity: 'immunity', heart: 'heart' };
  SS.GOAL_WEIGHTS = [1.0, 0.8, 0.6];

  /* ------------------------------------------------------------------ */
  /* Question cards, in graph order. `show` decides whether the engine asks
   * a card at all; `maya` is her answer; `spec` is the "What it changes"
   * note from the flow spec, shown in the viewer's notes panel. */
  var has = function (a, v) { return !!(a && a.picks && a.picks.indexOf(v) >= 0); };
  SS.has = has;

  SS.CARDS = [
    {
      id: 'A1', frame: 'F03', weight: 8, type: 'rank', max: 3,
      title: 'What would you most like to feel different 3 months from now?',
      helper: 'Pick up to 3, then drag to rank them.',
      why: 'Your first pick gets the most weight. Every question after this one follows from what you choose here.',
      options: [
        { id: 'sleep', label: 'Sleep better', icon: 'moon', area: 'sleep' },
        { id: 'energy', label: 'More energy', icon: 'bolt', area: 'energy' },
        { id: 'joints', label: 'Joints & recovery', icon: 'joint', area: 'joints' },
        { id: 'mood', label: 'Calmer mood', icon: 'smile', area: 'mood' },
        { id: 'focus', label: 'Sharper focus', icon: 'focus', area: 'mood' },
        { id: 'performance', label: 'Train harder', icon: 'run', area: 'performance' },
        { id: 'skin', label: 'Skin & hair', icon: 'drop', area: 'skin' },
        { id: 'immunity', label: 'Fewer colds', icon: 'shield', area: 'immunity' },
        { id: 'heart', label: 'Heart health', icon: 'heart', area: 'heart' }
      ],
      maya: { ranked: ['sleep', 'energy', 'joints'] },
      spec: 'Opens three goal branches; weights them 1.0 / 0.8 / 0.6.'
    },
    {
      id: 'A2', frame: 'F04', weight: 6, type: 'multi',
      title: 'Which part of sleep is hardest?',
      helper: 'Pick all that apply.',
      why: 'Trouble falling asleep and waking too early have different causes, so they lead to different supplements.',
      options: [
        { id: 'falling', label: 'Falling asleep' },
        { id: 'night', label: 'Waking at night' },
        { id: 'early', label: 'Waking too early' },
        { id: 'unrefreshed', label: 'Waking unrefreshed' },
        { id: 'snoring', label: 'Snoring or gasping' }
      ],
      show: function (A) { return SS.goalsOf(A).indexOf('sleep') >= 0; },
      maya: { picks: ['falling', 'unrefreshed'] },
      spec: 'sleep_onset signal. Snoring/gasping shows a stop card recommending a sleep-apnea check instead of supplements.'
    },
    {
      id: 'A3', frame: 'F05', weight: 6, type: 'multi',
      title: 'When you lie down, what’s going on?',
      helper: 'Pick all that apply.',
      why: 'What keeps you awake tells us whether to look at stress, body clock timing or minerals.',
      options: [
        { id: 'racing', label: 'Racing thoughts' },
        { id: 'legs', label: 'Legs feel restless or crawly' },
        { id: 'nottired', label: 'Not tired yet' },
        { id: 'phone', label: 'On my phone' }
      ],
      follow: {
        when: function (a) { return has(a, 'legs'); }, key: 'legsFreq', type: 'chips',
        label: 'How often do your legs feel like that?', options: ['Rarely', 'Sometimes', 'Most nights']
      },
      show: function (A) { return has(A.A2, 'falling'); },
      maya: { picks: ['racing', 'legs'], follow: { legsFreq: 'Sometimes' } },
      spec: 'stress_arousal +; restless legs adds low_iron_risk. First branch toast: “Restless legs can be linked to iron. We’ll look into that.”'
    },
    {
      id: 'A4', frame: 'F06', weight: 3, type: 'time',
      title: 'When is your last caffeinated drink?',
      helper: 'Coffee, tea, cola or energy drinks.',
      why: 'Caffeine stays in your system for hours. This won’t add a supplement, but it may change a habit.',
      show: function (A) { return SS.goalsOf(A).indexOf('sleep') >= 0; },
      maya: { mins: 15 * 60 + 30 },
      spec: 'No supplement; queues a lifestyle tip (caffeine cut-off 8 h before bed) for the results page.'
    },
    {
      id: 'B1', frame: 'F07', weight: 8, type: 'energy',
      title: 'Draw your usual energy through the day',
      helper: 'Drag the points, or start from the closest shape.',
      why: 'The shape matters more than the level. An afternoon dip points to different causes than being tired all day.',
      show: function (A) { return SS.goalsOf(A).indexOf('energy') >= 0; },
      maya: { points: [3, 6, 9, 7, 3, 3.5, 5, 4.5, 3] },
      spec: 'afternoon_crash; the engine picks the symptom cluster card next.'
    },
    {
      id: 'B2', frame: 'F08', weight: 17, type: 'multi', exclusive: 'none',
      title: 'Do you notice any of these?',
      helper: 'Pick all that apply.',
      why: 'These small signs often show up together. Together they help us tell low iron apart from low B12 or low vitamin D.',
      options: [
        { id: 'breath', label: 'Short of breath on stairs' },
        { id: 'cold', label: 'Cold hands or feet' },
        { id: 'hair', label: 'More hair shedding' },
        { id: 'nails', label: 'Brittle nails' },
        { id: 'tingling', label: 'Tingling hands or feet' },
        { id: 'wintermood', label: 'Low mood in winter' },
        { id: 'none', label: 'None of these' }
      ],
      show: function (A, sig) { return SS.goalsOf(A).indexOf('energy') >= 0 || !!sig.low_iron_risk; },
      maya: { picks: ['breath', 'cold', 'hair'] },
      spec: 'low_iron_risk now high; confidence ring jumps 31% → 48%.'
    },
    {
      id: 'B3', frame: 'F09', weight: 7, type: 'single',
      title: 'Do you eat meat or fish?',
      why: 'Iron, B12 and omega-3 depend on it. Your answer also filters out products made from animals.',
      options: [
        { id: 'meat', label: 'Yes, meat and fish' },
        { id: 'fish', label: 'Fish, but no meat' },
        { id: 'vegetarian', label: 'Vegetarian (eggs + dairy)' },
        { id: 'vegan', label: 'Vegan' }
      ],
      follow: {
        when: function (a) { return a && (a.pick === 'vegetarian' || a.pick === 'vegan' || a.pick === 'fish'); },
        key: 'years', type: 'stepper', label: 'For how many years?', min: 0, max: 40, step: 1, unit: 'years'
      },
      maya: { pick: 'vegetarian', follow: { years: 6 } },
      spec: 'b12_risk, omega3_gap, low_dietary_creatine; flags animal-derived products (collagen, fish oil, gelatin caps) as excluded.'
    },
    {
      id: 'B4', frame: 'F10', weight: 3, type: 'single',
      title: 'Do you have menstrual periods?',
      why: 'Periods are the most common cause of low iron in your age group.',
      options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }, { id: 'skip', label: 'Prefer not to say' }],
      show: function (A, sig) { return !!sig.low_iron_risk; },
      maya: { pick: 'yes' },
      spec: 'Opens B5 and the pregnancy gate.'
    },
    {
      id: 'B5', frame: 'F11', weight: 4, type: 'scale',
      title: 'How heavy are they on the heaviest day?',
      helper: 'Roughly how often you change a pad, tampon or cup.',
      why: 'Heavier periods lose more iron each month, which makes a blood test more useful.',
      options: [
        { id: 'light', label: 'Light', sub: 'Every 6+ h', level: 1 },
        { id: 'moderate', label: 'Moderate', sub: 'Every 4–6 h', level: 2 },
        { id: 'modheavy', label: 'Moderately heavy', sub: 'Every 2–3 h', level: 3 },
        { id: 'heavy', label: 'Very heavy', sub: 'Hourly or more', level: 4 }
      ],
      show: function (A) { return A.B4 && A.B4.pick === 'yes' && !SS.state.labs.ferritin; },
      maya: { pick: 'modheavy' },
      spec: 'Iron risk stays high; adds a note for the doctor letter.'
    },
    {
      id: 'B6', frame: 'F12', weight: 2, type: 'single',
      title: 'Are you pregnant, trying to conceive, or breastfeeding?',
      why: 'Some supplements aren’t safe in pregnancy. A yes switches us to a pregnancy-safe library.',
      options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
      show: function (A) { return A.B4 && A.B4.pick !== 'no'; },
      maya: { pick: 'no' },
      spec: 'Safety gate passed. (Yes would switch to a prenatal-specific library and hide ashwagandha.)'
    },
    {
      id: 'B7', frame: 'F13', weight: 4, type: 'single',
      title: 'Any bloodwork in the last 12 months with ferritin or B12?',
      why: 'Iron is the one supplement we won’t guess on. Too much is harmful, and only a blood test can tell.',
      options: [{ id: 'yes', label: 'Yes, enter values' }, { id: 'no', label: 'No' }, { id: 'notsure', label: 'Not sure' }],
      show: function (A, sig) { return (!!sig.low_iron_risk || !!sig.b12_risk) && SS.state.labs.ferritin == null; },
      maya: { pick: 'notsure' },
      spec: 'Iron becomes a locked card (“Test first”); app prepares a doctor-request note.'
    },
    {
      id: 'B8', frame: 'F14', weight: 3, type: 'body',
      title: 'Where do you feel it?',
      helper: 'Tap every spot that bothers you.',
      why: 'Where it hurts and when it hurts help us tell training soreness apart from something a physio should see.',
      show: function (A) { return SS.goalsOf(A).indexOf('joints') >= 0; },
      maya: { side: 'front', spots: ['knee_l', 'knee_r'] },
      spec: 'Opens the joint-pattern card.'
    },
    {
      id: 'B9', frame: 'F15', weight: 4, type: 'multi',
      title: function (A) { return 'When do your ' + SS.spotsPlural(A.B8) + ' bother you?'; },
      helper: 'Pick all that apply.',
      why: 'Soreness that fades within a day usually comes from training. Swelling or locking needs a professional, not a supplement.',
      options: [
        { id: 'during', label: 'During runs' },
        { id: 'after', label: 'After long runs' },
        { id: 'morning', label: 'Next morning' },
        { id: 'always', label: 'All the time' },
        { id: 'swelling', label: 'Swelling, locking or giving way' }
      ],
      follow: {
        when: function (a) { return has(a, 'after') || has(a, 'during') || has(a, 'morning'); },
        key: 'lasts', type: 'chips', label: 'How long does it last?', options: ['Eases within a day', '2–3 days', 'Longer']
      },
      show: function (A) { return A.B8 && A.B8.spots && A.B8.spots.length > 0; },
      maya: { picks: ['after'], follow: { lasts: 'Eases within a day' } },
      spec: 'exercise_soreness (not structural). Swelling/locking shows a physio referral card and stops joint supplements.'
    },
    {
      id: 'B10', frame: 'F16', weight: 4, type: 'training',
      title: 'Tell us about your training',
      why: 'Training load changes how much recovery support makes sense. If you have a race, it goes on your calendar.',
      show: function (A) {
        return has(A.B9, 'after') || has(A.B9, 'during') || SS.goalsOf(A).indexOf('performance') >= 0;
      },
      maya: { runs: 3, km: 25, hasEvent: true, eventType: 'half', date: '2026-12-13' },
      spec: 'endurance_load; event date goes to the calendar.'
    },
    {
      id: 'B11', frame: 'F17', weight: 5, type: 'pss',
      title: 'Stress check',
      why: 'These four questions are a standard stress scale (PSS-4). The score decides whether stress support belongs in your stack.',
      items: [
        { q: 'How often in the last month did you feel unable to control the important things in your life?', reverse: false },
        { q: 'How often did you feel confident about your ability to handle your personal problems?', reverse: true },
        { q: 'How often did you feel that things were going your way?', reverse: true },
        { q: 'How often did you feel difficulties were piling up so high that you could not overcome them?', reverse: false }
      ],
      scale: ['Never', 'Almost never', 'Sometimes', 'Fairly often', 'Very often'],
      sources: ['Work', 'Money', 'Relationships', 'Health', 'Family', 'Something else'],
      show: function (A, sig) { return !!sig.stress_arousal || SS.goalsOf(A).indexOf('mood') >= 0 || SS.goalsOf(A).indexOf('sleep') >= 0; },
      maya: { items: [3, 2, 2, 2], source: 'Work' },
      spec: 'stress_moderate (score > 8); main source picked on the next micro-card: work.'
    },
    {
      id: 'B12', frame: 'F18', weight: 4, type: 'single',
      title: 'On most days, how long are you outside between 10 am and 3 pm?',
      helper: 'We used your location: Toronto, 43.7° N.',
      why: 'From October to March the sun in Toronto is too low for your skin to make much vitamin D.',
      options: [
        { id: 'u15', label: 'Under 15 min' }, { id: '15', label: '15–30 min' },
        { id: '30', label: '30–60 min' }, { id: '60', label: '60+ min' }
      ],
      maya: { pick: 'u15' },
      spec: 'vitamin_d_risk high (latitude + season + indoor work).'
    },
    {
      id: 'C1', frame: 'F19', weight: 3, type: 'meds',
      title: 'What medicines or supplements do you take now?',
      helper: 'Start typing. Include birth control, inhalers and anything over the counter.',
      why: 'Some supplements change how medicines work. We check every pair before anything reaches your stack.',
      maya: { meds: ['coc'], query: '' },
      spec: 'Interaction check runs live: “We will never suggest St John’s wort to you: it can make birth control less reliable.” Adds magnesium and B-vitamin support weight.'
    },
    {
      id: 'C2', frame: 'F20', weight: 2, type: 'multi', exclusive: 'none',
      title: 'Do any of these apply?',
      helper: 'Pick all that apply.',
      why: 'Each of these rules out at least one common supplement.',
      options: [
        { id: 'thyroid', label: 'Thyroid condition' },
        { id: 'liverkidney', label: 'Liver or kidney disease' },
        { id: 'bleeding', label: 'Bleeding disorder or blood thinners' },
        { id: 'gallstones', label: 'Gallstones' },
        { id: 'autoimmune', label: 'Autoimmune condition' },
        { id: 'surgery', label: 'Surgery in the next 2 weeks' },
        { id: 'none', label: 'None of these' }
      ],
      maya: { picks: ['none'] },
      spec: 'No exclusions. (Thyroid or liver would hide ashwagandha; gallstones or blood thinners would hide curcumin.)'
    },
    {
      id: 'C3', frame: 'F21', weight: 1, type: 'multi', exclusive: 'none',
      title: 'Any allergies or things you avoid in capsules?',
      helper: 'Pick all that apply.',
      why: 'We filter products, not only ingredients. Many capsules are made from gelatin.',
      options: [
        { id: 'gelatin', label: 'Gelatin' }, { id: 'soy', label: 'Soy' }, { id: 'gluten', label: 'Gluten' },
        { id: 'shellfish', label: 'Shellfish' }, { id: 'none', label: 'None' }
      ],
      maya: { picks: ['gelatin'] },
      spec: 'Product filter: vegetarian capsules only.'
    },
    {
      id: 'D1', frame: 'F22', weight: 1, type: 'budget',
      title: 'Your monthly budget',
      helper: 'In Canadian dollars.',
      why: 'If the stack costs more than this, we drop the lowest-value item first and tell you which one.',
      maya: { amount: 80 },
      spec: 'Optimizer may drop the lowest-value item if over budget.'
    },
    {
      id: 'D2', frame: 'F23', weight: 1, type: 'pills',
      title: 'How many pills a day is OK? Powders?',
      why: 'A plan you can keep beats a perfect one. Powders can replace several pills.',
      maya: { max: 6, powders: true },
      spec: 'Creatine delivered as powder; avoids a 7th pill.'
    },
    {
      id: 'D3', frame: 'F24', weight: 1, type: 'day',
      title: 'Your usual day',
      helper: 'We build your calendar from these times.',
      why: 'Some supplements need food, some need distance from others, and magnesium works best before bed.',
      maya: { wake: 420, breakfast: 450, lunch: 750, dinner: 1140, bed: 1380, runDays: ['tue', 'thu', 'sat'] },
      spec: 'Drives every slot in the calendar.'
    }
  ];
  SS.CARD = {};
  SS.CARDS.forEach(function (c, i) { c.index = i; SS.CARD[c.id] = c; });

  /* Body-map tap targets (B8). Coordinates are in the 200 x 400 figure. */
  SS.BODY_SPOTS = {
    front: [
      { id: 'neck', label: 'Neck', x: 100, y: 74 },
      { id: 'shoulder_l', label: 'Left shoulder', x: 140, y: 96 },
      { id: 'shoulder_r', label: 'Right shoulder', x: 60, y: 96 },
      { id: 'elbow_l', label: 'Left elbow', x: 154, y: 160 },
      { id: 'elbow_r', label: 'Right elbow', x: 46, y: 160 },
      { id: 'wrist_l', label: 'Left wrist or hand', x: 162, y: 214 },
      { id: 'wrist_r', label: 'Right wrist or hand', x: 38, y: 214 },
      { id: 'hip_l', label: 'Left hip', x: 124, y: 210 },
      { id: 'hip_r', label: 'Right hip', x: 76, y: 210 },
      { id: 'knee_l', label: 'Left knee', x: 120, y: 290 },
      { id: 'knee_r', label: 'Right knee', x: 80, y: 290 },
      { id: 'ankle_l', label: 'Left ankle or foot', x: 118, y: 370 },
      { id: 'ankle_r', label: 'Right ankle or foot', x: 82, y: 370 }
    ],
    back: [
      { id: 'neck_b', label: 'Back of neck', x: 100, y: 74 },
      { id: 'upperback', label: 'Upper back', x: 100, y: 122 },
      { id: 'lowerback', label: 'Lower back', x: 100, y: 186 },
      { id: 'glute_l', label: 'Left glute', x: 80, y: 222 },
      { id: 'glute_r', label: 'Right glute', x: 120, y: 222 },
      { id: 'hamstring_l', label: 'Left hamstring', x: 80, y: 262 },
      { id: 'hamstring_r', label: 'Right hamstring', x: 120, y: 262 },
      { id: 'calf_l', label: 'Left calf', x: 82, y: 326 },
      { id: 'calf_r', label: 'Right calf', x: 118, y: 326 },
      { id: 'heel_l', label: 'Left heel', x: 84, y: 380 },
      { id: 'heel_r', label: 'Right heel', x: 116, y: 380 }
    ]
  };

  /* Medicines and supplements for the C1 search-as-you-type field. */
  SS.MEDS = [
    { id: 'coc', name: 'Combined oral contraceptive', alias: 'birth control pill, the pill', cls: 'hormonal' },
    { id: 'pop', name: 'Progestin-only pill', alias: 'mini pill, birth control', cls: 'hormonal' },
    { id: 'ring', name: 'Contraceptive ring', alias: 'birth control ring', cls: 'hormonal' },
    { id: 'levo', name: 'Levothyroxine', alias: 'Synthroid, thyroid', cls: 'thyroid' },
    { id: 'sert', name: 'Sertraline', alias: 'Zoloft, SSRI', cls: 'ssri' },
    { id: 'escit', name: 'Escitalopram', alias: 'Cipralex, SSRI', cls: 'ssri' },
    { id: 'fluox', name: 'Fluoxetine', alias: 'Prozac, SSRI', cls: 'ssri' },
    { id: 'bupro', name: 'Bupropion', alias: 'Wellbutrin', cls: 'other' },
    { id: 'warf', name: 'Warfarin', alias: 'Coumadin, blood thinner', cls: 'thinner' },
    { id: 'apix', name: 'Apixaban', alias: 'Eliquis, blood thinner', cls: 'thinner' },
    { id: 'asa', name: 'Low-dose aspirin', alias: 'ASA', cls: 'thinner' },
    { id: 'metf', name: 'Metformin', alias: 'diabetes', cls: 'b12drain' },
    { id: 'omep', name: 'Omeprazole', alias: 'Losec, acid reducer', cls: 'b12drain' },
    { id: 'panto', name: 'Pantoprazole', alias: 'Tecta, acid reducer', cls: 'b12drain' },
    { id: 'lisin', name: 'Lisinopril', alias: 'blood pressure', cls: 'other' },
    { id: 'ator', name: 'Atorvastatin', alias: 'Lipitor, cholesterol', cls: 'other' },
    { id: 'isot', name: 'Isotretinoin', alias: 'Accutane, Epuris', cls: 'other' },
    { id: 'cetir', name: 'Cetirizine', alias: 'Reactine, allergy', cls: 'other' },
    { id: 'salb', name: 'Salbutamol inhaler', alias: 'Ventolin, asthma', cls: 'other' },
    { id: 'pred', name: 'Prednisone', alias: 'steroid', cls: 'other' },
    { id: 'lith', name: 'Lithium', alias: 'mood', cls: 'other' },
    { id: 'mel', name: 'Melatonin (supplement)', alias: 'sleep', cls: 'supp' },
    { id: 'vitd', name: 'Vitamin D (supplement)', alias: 'D3', cls: 'supp' },
    { id: 'multi', name: 'Multivitamin', alias: 'supplement', cls: 'supp' },
    { id: 'fishoil', name: 'Fish oil', alias: 'omega-3 supplement', cls: 'supp' },
    { id: 'ironsupp', name: 'Iron (supplement)', alias: 'ferrous', cls: 'supp' }
  ];
  SS.MED = {};
  SS.MEDS.forEach(function (m) { SS.MED[m.id] = m; });

  /* ------------------------------------------------------------------ */
  /* Supplements. `contrib` is the projected benefit per body area (demo
   * scoring from the spec chart). `primary`: at least one of these signals
   * must be active for the item to be added. `support`: signals quoted in
   * the "Why you" line when present. */
  SS.SUPPS = {
    d3k2: {
      id: 'd3k2', name: 'Vitamin D3 + K2', sub: 'MK-7', short: 'D3 + K2', color: '#3B7BD0',
      dose: '2,000 IU D3 + K2', slot: 'breakfast', when: 'Breakfast, with fat', evidence: 'Strong',
      amount: '1 capsule', units: 1, form: 'capsule', freq: 'daily', rampDay: 0,
      cue: 'Take D3 with food that has some fat.',
      primary: ['vitamin_d_risk'], support: ['vitamin_d_risk', 'afternoon_crash'],
      contrib: { sleep: 0.5, energy: 1.5, joints: 0.5, mood: 0.5, performance: 0.5, skin: 0.5, immunity: 2, heart: 0.5 },
      mech: {
        immunity: ['Supports immune cell function when your levels are low', 'Strong'],
        energy: ['Low vitamin D is linked to tiredness; topping up helps when you’re low', 'Moderate'],
        sleep: ['Low levels are linked to poorer sleep quality', 'Emerging'],
        mood: ['May support winter mood when you’re low', 'Emerging'],
        joints: ['Supports bone and muscle health', 'Moderate'],
        performance: ['Supports muscle function', 'Emerging'],
        skin: ['Plays a role in the hair growth cycle', 'Emerging'],
        heart: ['K2 helps direct calcium to bone', 'Emerging']
      },
      detail: {
        does: 'Vitamin D supports bones, muscles and immune function. At 43.7° N your skin makes very little from October to April. K2 (MK-7) helps direct calcium into bone.',
        research: 'Strong evidence that supplements correct low vitamin D status. Benefits for energy and mood show up mainly in people who start low, which is likely for you this time of year.',
        how: '1 capsule with breakfast. It’s fat-soluble, so take it with food that has some fat (eggs, yogurt, nut butter).',
        side: 'Rare at 2,000 IU. Don’t add another vitamin D product without checking the total.',
        interacts: 'K2 can affect warfarin. Nothing you told us interacts with it.'
      }
    },
    omega3: {
      id: 'omega3', name: 'Algae omega-3', sub: 'EPA + DHA', short: 'Omega-3', color: '#D96B2B',
      dose: '~500–600 mg EPA + DHA', slot: 'lunch', when: 'Lunch', evidence: 'Moderate',
      amount: '2 softgels', units: 2, form: 'softgel', freq: 'daily', rampDay: 0,
      cue: 'With a meal to avoid aftertaste.',
      primary: ['omega3_gap'], support: ['omega3_gap', 'exercise_soreness', 'stress_moderate'],
      contrib: { sleep: 0.5, joints: 1.5, mood: 1, performance: 0.5, skin: 1, immunity: 0.5, heart: 1.5 },
      mech: {
        joints: ['Calms exercise-related inflammation and stiffness', 'Moderate'],
        heart: ['EPA and DHA support healthy triglycerides and heart rhythm', 'Strong'],
        mood: ['EPA has small benefits for low mood', 'Moderate'],
        skin: ['Supports the skin barrier and scalp', 'Emerging'],
        sleep: ['DHA plays a role in sleep regulation', 'Emerging'],
        performance: ['May reduce muscle soreness after hard sessions', 'Emerging'],
        immunity: ['Helps resolve inflammation', 'Emerging']
      },
      detail: {
        does: 'EPA and DHA support heart, brain and joint health. Vegetarian diets have almost none, and algae is where fish get theirs.',
        research: 'Moderate: modest drops in exercise soreness and joint stiffness, and small mood benefits, mostly from EPA.',
        how: '2 softgels with lunch. Taking them with a meal avoids aftertaste.',
        side: 'Mild stomach upset in some people. Take with food.',
        interacts: 'High doses can add to blood thinners. Nothing you told us interacts with it.'
      }
    },
    creatine: {
      id: 'creatine', name: 'Creatine monohydrate', sub: '', short: 'Creatine', color: '#22A08A',
      dose: '3–5 g', slot: 'breakfast', when: 'Morning, any meal', evidence: 'Strong',
      amount: '1 scoop, 3–5 g', units: 1, form: 'powder', freq: 'daily', rampDay: 6,
      cue: 'Stir into any drink.',
      runCue: 'Run day: after your run is fine too.',
      primary: ['low_dietary_creatine'], support: ['low_dietary_creatine', 'endurance_load', 'afternoon_crash'],
      contrib: { energy: 1, joints: 0.5, mood: 0.5, performance: 2.5 },
      mech: {
        performance: ['Tops up muscle creatine for stronger repeated efforts', 'Strong'],
        energy: ['Supports brain energy, especially on short sleep', 'Emerging'],
        joints: ['Helps muscle recovery between sessions', 'Moderate'],
        mood: ['Early evidence for mood support', 'Emerging']
      },
      detail: {
        does: 'Tops up creatine stores in muscle and brain. Vegetarians start lower, so they tend to respond more.',
        research: 'Strong for strength and repeated-effort performance. Emerging evidence for thinking and focus, especially after short sleep.',
        how: '1 scoop (3–5 g) in any drink with breakfast. Timing doesn’t matter much; taking it every day does.',
        side: 'About 0.5–1 kg of water weight in muscle in the first weeks. Rare stomach upset if taken dry.',
        interacts: 'Nothing you told us interacts with it. Check with a doctor first if you have kidney disease.'
      }
    },
    b12: {
      id: 'b12', name: 'Vitamin B12', sub: 'methylcobalamin', short: 'B12', color: '#3E4F8C',
      dose: '1,000 mcg', slot: 'breakfast', when: 'Breakfast, Mon/Wed/Fri', evidence: 'Strong',
      amount: '1 capsule', units: 1, form: 'capsule', freq: 'mwf', rampDay: 3,
      cue: 'Mon/Wed/Fri only.',
      primary: ['b12_risk'], support: ['b12_risk', 'afternoon_crash', 'med_contraceptive'],
      contrib: { energy: 1.5, skin: 0.5 },
      mech: {
        energy: ['Needed to make red blood cells that carry oxygen', 'Strong'],
        skin: ['Low B12 can show up as hair and skin changes', 'Emerging']
      },
      detail: {
        does: 'B12 is needed for red blood cells and nerves. Plant-based diets supply little of it, and your stores run down slowly over years.',
        research: 'Strong: vegetarians often have low B12, and supplements reliably raise it.',
        how: '1,000 mcg with breakfast on Mon, Wed and Fri. Your body absorbs a small share of each dose, so three days a week is enough.',
        side: 'Very rare. Your body clears what it doesn’t use.',
        interacts: 'Metformin and acid reducers lower B12. Neither applies to you.'
      }
    },
    magnesium: {
      id: 'magnesium', name: 'Magnesium bisglycinate', sub: '', short: 'Magnesium', color: '#D45A86',
      dose: '200 mg elemental', slot: 'winddown', when: '60–90 min before bed', evidence: 'Moderate',
      amount: '1 scoop, 200 mg, in warm water', units: 1, form: 'powder', freq: 'daily', rampDay: 3,
      cue: '90 min before bed. Phone away.',
      primary: ['sleep_onset'], support: ['sleep_onset', 'endurance_load', 'med_contraceptive'],
      contrib: { sleep: 2, energy: 0.5, joints: 0.5, mood: 1, heart: 0.5 },
      mech: {
        sleep: ['Supports muscle relaxation and calmer sleep onset', 'Moderate'],
        mood: ['Helps regulate the stress response', 'Moderate'],
        joints: ['Supports muscle recovery after training', 'Emerging'],
        energy: ['Needed for energy metabolism', 'Emerging'],
        heart: ['Supports normal heart rhythm and blood pressure', 'Moderate']
      },
      detail: {
        does: 'Magnesium helps muscles relax and calms the nervous system. Hard training and the pill can both lower your levels.',
        research: 'Moderate: small improvements in falling asleep, mainly in people who get too little magnesium. The glycinate form is gentle on the stomach.',
        how: '1 scoop (200 mg) in warm water 60–90 minutes before bed.',
        side: 'Loose stools at higher doses. Glycinate is the gentlest form.',
        interacts: 'Keep 4 hours away from thyroid medicine and some antibiotics. Neither applies to you.'
      }
    },
    ashwagandha: {
      id: 'ashwagandha', name: 'Ashwagandha', sub: 'KSM-66 extract', short: 'Ashwagandha', color: '#4C8C2E',
      dose: '600 mg', slot: 'dinner', when: 'Dinner; 8 weeks on, 2 off', evidence: 'Moderate',
      amount: '600 mg, 1 capsule', units: 1, form: 'capsule', freq: 'cycle', rampDay: 9,
      cue: 'With food.',
      primary: ['stress_moderate'], support: ['stress_moderate', 'sleep_onset', 'stress_arousal'],
      contrib: { sleep: 2.5, energy: 0.5, mood: 2.5, performance: 1 },
      mech: {
        sleep: ['Lowers the stress arousal that keeps you awake', 'Moderate'],
        mood: ['Lowers perceived stress scores over 8 weeks', 'Moderate'],
        performance: ['Small gains in endurance in trained people', 'Emerging'],
        energy: ['May ease stress-related fatigue', 'Emerging']
      },
      detail: {
        does: 'A root extract that may lower stress hormones and how stressed you feel.',
        research: 'Moderate: several randomized trials of KSM-66 show lower stress scores and faster sleep onset over 8 weeks.',
        how: '1 capsule (600 mg) with dinner. 8 weeks on, then 2 weeks off.',
        side: 'Drowsiness or stomach upset. Rare liver injury reports: stop and see a doctor if you notice yellowing skin or dark urine.',
        interacts: 'Thyroid medicine, sedatives and immune suppressants. Not for pregnancy. None of these apply to you.'
      }
    },
    curcumin: {
      id: 'curcumin', name: 'Curcumin', sub: 'enhanced-absorption form', short: 'Curcumin', color: '#8257C9',
      dose: '500 mg', slot: 'dinner', when: 'Dinner', evidence: 'Moderate',
      amount: '1 capsule', units: 1, form: 'capsule', freq: 'daily', rampDay: 12,
      cue: 'With food.',
      primary: ['exercise_soreness'], support: ['exercise_soreness', 'endurance_load'],
      contrib: { joints: 2, immunity: 0.5, heart: 0.5 },
      mech: {
        joints: ['Eases exercise-related knee soreness', 'Moderate'],
        immunity: ['Calms general inflammation', 'Emerging'],
        heart: ['May support healthy blood vessels', 'Emerging']
      },
      detail: {
        does: 'The active compound in turmeric. It may ease soreness and inflammation after hard training.',
        research: 'Moderate: small trials show less muscle soreness and knee discomfort. Plain turmeric is poorly absorbed, so we use an enhanced form.',
        how: '1 capsule with dinner. Take it with food.',
        side: 'Stomach upset. Rare liver reports with high-absorption forms.',
        interacts: 'Blood thinners and gallstones. Neither applies to you.'
      }
    },
    iron: {
      id: 'iron', name: 'Iron bisglycinate', sub: '', short: 'Iron', color: '#7A5C3E',
      dose: '25 mg elemental', slot: 'lunch', when: 'Lunch, every other day', evidence: 'Strong',
      amount: '1 capsule', units: 1, form: 'capsule', freq: 'alt', rampDay: 15,
      cue: 'With vitamin C food, 2 h away from coffee and tea.',
      primary: ['low_iron_risk'], support: ['low_iron_risk', 'hair_shedding'],
      contrib: { sleep: 0.5, energy: 1.5, performance: 0.5, skin: 2 },
      mech: {
        skin: ['Low ferritin is a common cause of hair shedding', 'Moderate'],
        energy: ['Rebuilds iron stores for oxygen transport', 'Strong'],
        sleep: ['Low iron is linked to restless legs', 'Moderate'],
        performance: ['Supports endurance when stores are low', 'Moderate']
      },
      detail: {
        does: 'Rebuilds your iron stores. Your ferritin result shows they are low.',
        research: 'Strong when ferritin is low. Taking it every other day is absorbed as well as daily and is easier on the stomach.',
        how: '1 capsule at lunch every other day, with vitamin C food. Keep it 2 hours away from coffee, tea and dairy.',
        side: 'Constipation or stomach upset. Bisglycinate is the gentlest form.',
        interacts: 'Separate from magnesium and calcium by 2 hours (your calendar already does).'
      }
    }
  };
  SS.SUPP_ORDER = ['d3k2', 'omega3', 'creatine', 'b12', 'magnesium', 'ashwagandha', 'curcumin'];

  /* Items the engine considers and then removes, so it can show its work. */
  SS.EXCLUSIONS = {
    collagen: { name: 'Collagen peptides', usual: 'The usual joint pick' },
    sjw: { name: 'St John’s wort', usual: 'A common stress pick' },
    melatonin: { name: 'Melatonin', usual: 'A common sleep pick' }
  };

  /* ------------------------------------------------------------------ */
  /* Products: best match, alternative, and options the filter removed.
   * Prices are CAD demo values per dose. Thumbnails are neutral placeholders. */
  var A = SS.amazon;
  SS.PRODUCTS = {
    d3k2: [
      { id: 'ps-d3k2', brand: 'Pure Synergy', name: 'D3 + K2 Complex', note: '2,000 IU, vegan algae-based D3', certs: ['Vegan', 'Third-party tested'], price: 0.27, servings: 60, form: 'capsule', fit: 'fits', link: A('Pure Synergy D3 K2 Complex'), rating: 4.6, reviews: 1800 },
      { id: 'th-dk2', brand: 'Thorne', name: 'Vitamin D/K2 Liquid', note: 'Drops allow exact dosing', certs: ['NSF Certified for Sport'], price: 0.22, servings: 150, form: 'drops', fit: 'fits', link: A('Thorne Vitamin D K2 Liquid'), rating: 4.7, reviews: 2600 },
      { id: 'sr-d3k2', brand: 'Sports Research', name: 'Vitamin D3 + K2', note: 'Widely top-rated', certs: ['Third-party tested'], price: 0.15, servings: 60, form: 'softgel', fit: 'over', filtered: '5,000 IU per softgel is 2.5× your target', link: A('Sports Research Vitamin D3 K2'), rating: 4.7, reviews: 52000 }
    ],
    omega3: [
      { id: 'nn-algae', brand: 'Nordic Naturals', name: 'Algae Omega', note: '390 mg DHA + 195 mg EPA per 2 softgels', certs: ['Vegan', 'Third-party tested'], price: 0.66, servings: 30, form: 'softgel', fit: 'fits', contains: ['carrageenan'], link: A('Nordic Naturals Algae Omega'), rating: 4.5, reviews: 3100 },
      { id: 'sr-vegan', brand: 'Sports Research', name: 'Vegan Omega-3', note: 'Carrageenan-free', certs: ['Vegan', 'Third-party tested'], price: 0.62, servings: 30, form: 'softgel', fit: 'fits', link: A('Sports Research Vegan Omega-3'), rating: 4.6, reviews: 9800 },
      { id: 'nn-ult', brand: 'Nordic Naturals', name: 'Ultimate Omega (fish oil)', note: 'The usual pick for meat and fish eaters', certs: ['Third-party tested'], price: 0.55, servings: 30, form: 'softgel', fit: 'fits', animal: true, link: A('Nordic Naturals Ultimate Omega'), rating: 4.7, reviews: 21000 }
    ],
    creatine: [
      { id: 'th-cre', brand: 'Thorne', name: 'Creatine', note: 'Creapure, NSF Certified for Sport', certs: ['NSF Certified for Sport', 'Creapure'], price: 0.55, servings: 90, form: 'powder', fit: 'fits', link: A('Thorne Creatine Creapure'), rating: 4.7, reviews: 7400 },
      { id: 'nc-cre', brand: 'Nutricost', name: 'Creatine Monohydrate', note: 'Lowest cost per serving', certs: ['Third-party tested'], price: 0.18, servings: 100, form: 'powder', fit: 'fits', link: A('Nutricost Creatine Monohydrate'), rating: 4.6, reviews: 38000 },
      { id: 'gen-crecap', brand: 'Generic', name: 'Creatine capsules', note: '750 mg per capsule', certs: [], price: 0.30, servings: 60, form: 'capsule', fit: 'split', filtered: 'Needs 5 capsules a day; you said powders are OK', link: A('creatine monohydrate capsules'), rating: 4.3, reviews: 900 }
    ],
    b12: [
      { id: 'th-b12', brand: 'Thorne', name: 'Vitamin B12 (methylcobalamin)', note: 'Active form, vegetarian capsule', certs: ['Vegetarian capsule', 'Third-party tested'], price: 0.22, servings: 60, form: 'capsule', fit: 'fits', link: A('Thorne Vitamin B12 Methylcobalamin'), rating: 4.7, reviews: 4200 },
      { id: 'now-b12', brand: 'NOW', name: 'Methyl B-12 1,000 mcg lozenges', note: 'The low-cost lozenge option', certs: ['GMP certified'], price: 0.08, servings: 100, form: 'lozenge', fit: 'fits', link: A('NOW Methyl B-12 1000 mcg lozenges'), rating: 4.7, reviews: 15000 }
    ],
    magnesium: [
      { id: 'th-mg', brand: 'Thorne', name: 'Magnesium Bisglycinate powder', note: 'Reviewer’s pick for sleep; adds no pills', certs: ['NSF Certified for Sport'], price: 0.36, servings: 90, form: 'powder', fit: 'fits', link: A('Thorne Magnesium Bisglycinate'), rating: 4.6, reviews: 5100 },
      { id: 'db-mg', brand: 'Doctor’s Best', name: 'High Absorption Magnesium', note: '200 mg per 2 tablets', certs: ['Third-party tested'], price: 0.18, servings: 120, form: 'tablet', units: 2, fit: 'fits', link: A('Doctors Best High Absorption Magnesium'), rating: 4.6, reviews: 61000 },
      { id: 'gen-mgox', brand: 'Generic', name: 'Magnesium oxide 400 mg', note: 'Cheapest form', certs: [], price: 0.06, servings: 120, form: 'tablet', fit: 'over', filtered: 'Poorly absorbed form that often upsets the stomach', link: A('magnesium oxide 400 mg'), rating: 4.2, reviews: 3000 }
    ],
    ashwagandha: [
      { id: 'tl-ksm', brand: 'Transparent Labs', name: 'KSM-66 Ashwagandha', note: '600 mg in one vegan capsule', certs: ['KSM-66', 'Vegan', 'Third-party tested'], price: 0.30, servings: 60, form: 'capsule', fit: 'fits', link: 'https://www.transparentlabs.com/', linkLabel: 'Brand site', rating: 4.8, reviews: 1500 },
      { id: 'nc-ksm', brand: 'Nutricost', name: 'KSM-66 Ashwagandha 600 mg', note: 'Amazon.ca alternative', certs: ['KSM-66', 'Third-party tested'], price: 0.20, servings: 120, form: 'capsule', fit: 'fits', link: A('Nutricost KSM-66 Ashwagandha'), rating: 4.6, reviews: 12000 },
      { id: 'gen-gummy', brand: 'Generic', name: 'Ashwagandha gummies', note: 'Gummy format', certs: [], price: 0.35, servings: 60, form: 'gummy', fit: 'lower', contains: ['gelatin'], link: A('ashwagandha gummies'), rating: 4.3, reviews: 7000 }
    ],
    curcumin: [
      { id: 'th-cur', brand: 'Thorne', name: 'Curcumin Phytosome (Meriva)', note: 'Strongest absorption case', certs: ['NSF Certified for Sport'], price: 0.85, servings: 60, form: 'capsule', fit: 'fits', unavailable: true, link: A('Thorne Curcumin Phytosome'), rating: 4.6, reviews: 3300 },
      { id: 'now-cb', brand: 'NOW', name: 'CurcuBrain (Longvida)', note: '400 mg Longvida per capsule', certs: ['Informed Sport'], price: 0.38, servings: 50, form: 'capsule', fit: 'lower', link: A('NOW CurcuBrain Longvida'), rating: 4.5, reviews: 2100 },
      { id: 'gen-turm', brand: 'Generic', name: 'Turmeric root capsules', note: 'Plain turmeric powder', certs: [], price: 0.12, servings: 100, form: 'capsule', fit: 'lower', filtered: 'Plain turmeric is poorly absorbed', link: A('turmeric capsules'), rating: 4.4, reviews: 9000 }
    ],
    iron: [
      { id: 'th-fe', brand: 'Thorne', name: 'Iron Bisglycinate', note: '25 mg, gentle on the stomach', certs: ['NSF Certified for Sport'], price: 0.15, servings: 60, form: 'capsule', fit: 'fits', link: A('Thorne Iron Bisglycinate'), rating: 4.7, reviews: 6300 },
      { id: 'gen-fes', brand: 'Generic', name: 'Ferrous sulfate 300 mg', note: 'Cheapest form', certs: [], price: 0.04, servings: 100, form: 'tablet', fit: 'over', filtered: 'Harder on the stomach at the same dose', link: A('ferrous sulfate'), rating: 4.3, reviews: 2000 }
    ]
  };

  SS.RANK_STEPS = [
    'Third-party certification (NSF Certified for Sport, USP, Informed Sport, Creapure)',
    'Dose fit to your target',
    'Form fit (no gelatin, powders OK)',
    'Review rating and volume',
    'Price per effective dose'
  ];

  SS.DISCLAIMER = 'StackSense gives general information, not medical advice. Talk to a doctor or pharmacist before starting supplements, especially if you take medication, are pregnant, or have a health condition.';
  SS.AFFILIATE = 'We may earn a commission when you buy through these links. It never changes what we recommend.';
})(window.SS = window.SS || {});
