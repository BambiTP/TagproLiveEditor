  const TPU = 2.5;


  const MAP_ID = 97675;


  const gameConfig = {
    gravityX: 0,
    // Normal CTF has no gravity - this is the default, same as BamBall's
    // own gravityY:0 default. The "Gravity preset" button (editor.js's
    // GRAVITY_PRESET) is the only thing that turns it on, overriding this
    // to real TagPro's own gravity-mode value: 9.8/2. Passed straight into
    // b2World's constructor (game.js) - Box2D integrates this by dt itself
    // every Step(), so it's already a true tiles/s^2 acceleration, the same
    // unit Box2D itself uses.
    gravityY: 0,

    // Jump: pressing up on a fresh press (not held) adds -jumpStrength onto
    // the ball's current vy, on top of - not instead of - the normal
    // up/down accel thrust (see game.js's applyJumps()/moveBalls()). Inert
    // in normal CTF - applyJumps() itself no-ops when gravityX/Y are both
    // 0, and jumpCharges:0 here means no charges to spend even if it didn't.
    // Charges refill when the bottom of the ball touches a wall/floor below
    // it (contactListener.js's wall-contact handling); the Gravity preset
    // sets jumpCharges to 2. jumpStrength is measured, not guessed: a real
    // gravity-mode replay (5 jumps from a dead stop) recorded ly:-4.41 one
    // tick (0.017s) after "up" was pressed - not the raw impulse itself,
    // since gravity/damping/accel have already acted on it by the time
    // it's sampled. Simulating that single tick backward (this file's own
    // accel/gravity/damping values, same order as game.js's step()) shows a
    // clean -4.5 impulse decays to -4.4066 after one tick - within 0.003 of
    // the -4.41 actually observed. 4.5 is that raw real-TagPro (Box2D)
    // number - *TPU converts it to tiles same as every other field here.
    jumpStrength: 4.5 * TPU, // 11.25
    jumpCharges: 0,

    radius:         0.19  * TPU,
    density:        0.475,
    friction:       0.5,
    restitution:    0.2,
    // Wall fixtures don't read friction/restitution off the tile data at
    // all (game.js's makeBody) - these are their only source, so they
    // default to what an unset b2FixtureDef already gives you (Box2D's own
    // defaults), leaving current behavior unchanged. Gravity mode overrides
    // both (see editor.js's GRAVITY_PRESET) - real TagPro's own gravity
    // event handler sets 0 friction / 0.3 restitution on walls too.
    wallFriction:   0.2,
    wallRestitution: 0,
    linearDamping:  0.5,
    angularDamping: 0.5,
    accel:          0.025 * TPU,
    maxSpeed:       2.5   * TPU,

    boostMultiplier:     2.9,

    bombRadius:          0.4 * 7   * TPU,
    bombStrength:        1.25      * TPU,

    rollingBombRadius:   0.4 * 5   * TPU,
    rollingBombStrength: 0.75      * TPU,

    portalExploRadius:   0.4 * 4   * TPU,
    portalExploStrength: 0.25      * TPU,

    deathExploRadius:    0.4 * 3.5 * TPU,
    deathExploStrength:  0.25      * TPU,

    boostCooldown:     10000,
    redBoostCooldown:  10000,
    blueBoostCooldown: 10000,
    bombCooldown:      30000,

    teamTileAccel:    0.037 * TPU,
    teamTileMaxSpeed: 5     * TPU,
    jukeJuiceAccel:   0.031 * TPU,
    jukeJuiceMaxSpeed: 2.5 * TPU,
    gravityWellRadius: 0.4 * 4 * TPU,
    gravityWellStrength: 0.025 * TPU,
    powerupRespawn:     5000,
    tagproTimer:     20000,
rollingBombTimer: 20000,
jukeJuiceTimer: 20000,
  };

    const IMAGE_MAP = {
    tiles:        'https://static.koalabeast.com/textures/musclescupgradients/tiles.png',
    speedpad:     'https://static.koalabeast.com/textures/musclescupgradients/speedpad.png',
    speedpadRed:  'https://static.koalabeast.com/textures/musclescupgradients/speedpadred.png',
    speedpadBlue: 'https://static.koalabeast.com/textures/musclescupgradients/speedpadblue.png',
    portal:       'https://static.koalabeast.com/textures/musclescupgradients/portal.png',
    portalRed:    'https://static.koalabeast.com/textures/musclescupgradients/portalred.png',
    portalBlue:   'https://static.koalabeast.com/textures/musclescupgradients/portalblue.png',
    gravitywell:  'https://static.koalabeast.com/images/gravitywell.png'
  };