var physicsData = [
  { id: 1,    name: 'Wall',              category: 'wall',        type: 'square',  size: 40, sensor: false },
  { id: 1.2,  name: '45BL',              type: 'vector', vectors: [{ x: -0.5, y: -0.5 }, { x:  0.5, y: -0.5 }, { x: -0.5, y:  0.5 }] },
  { id: 1.3,  name: '45TL',              type: 'vector', vectors: [{ x:  0.5, y: -0.5 }, { x:  0.5, y:  0.5 }, { x: -0.5, y: -0.5 }] },
  { id: 1.1,  name: '45TR',              type: 'vector', vectors: [{ x: -0.5, y:  0.5 }, { x: -0.5, y: -0.5 }, { x:  0.5, y:  0.5 }] },
  { id: 1.4,  name: '45BR',              type: 'vector', vectors: [{ x:  0.5, y:  0.5 }, { x: -0.5, y:  0.5 }, { x:  0.5, y: -0.5 }] },

  { id: 2,    name: 'Floor',             category: 'floor',       type: 'square',  size: 40, sensor: true  },

  { id: 16,   name: 'YellowFlag',        category: 'yellowFlag',  type: 'circle',  size: 30, sensor: true  },
  { id: 16.1, name: 'YellowFlagTaken',   category: 'yellowFlag',  type: 'circle',  size: 30, sensor: true  },
  { id: 3,    name: 'RedFlag',           category: 'redFlag',     type: 'circle',  size: 30, sensor: true  },
  { id: 3.1,  name: 'RedFlagTaken',      category: 'redFlag',     type: 'circle',  size: 30, sensor: true  },
  { id: 4,    name: 'BlueFlag',          category: 'blueFlag',    type: 'circle',  size: 30, sensor: true  },
  { id: 4.1,  name: 'BlueFlagTaken',     category: 'blueFlag',    type: 'circle',  size: 30, sensor: true  },

  { id: 17,   name: 'RedGoal',           category: 'redGoal',     type: 'square',  size: 40, sensor: true  },
  { id: 18,   name: 'BlueGoal',          category: 'blueGoal',    type: 'square',  size: 40, sensor: true  },

  { id: 5,    name: 'Boost',             category: 'boost',       type: 'circle',  size: 30, sensor: true  },
  { id: 14,   name: 'RedBoost',          category: 'redBoost',    type: 'circle',  size: 30, sensor: true  },
  { id: 15,   name: 'BlueBoost',         category: 'blueBoost',   type: 'circle',  size: 30, sensor: true  },
    { id: 10,   name: 'Bomb',              category: 'bomb',        type: 'circle',  size: 30, sensor: true  },

  { id: 5.1,  name: 'BoostTaken',        category: 'boostTaken',     type: 'circle', size: 30, sensor: true },
  { id: 14.1, name: 'RedBoostTaken',     category: 'redBoostTaken',  type: 'circle', size: 30, sensor: true },
  { id: 15.1, name: 'BlueBoostTaken',    category: 'blueBoostTaken', type: 'circle', size: 30, sensor: true },
  { id: 10.1, name: 'BombTaken',         category: 'bombTaken',      type: 'circle', size: 30, sensor: true },

  { id: 6,    name: 'PupEmpty',          category: 'powerup',     type: 'circle',  size: 30, sensor: true  },
  { id: 6.1,  name: 'PupJJ',             category: 'powerup',     type: 'circle',  size: 30, sensor: true  },
  { id: 6.2,  name: 'PupRB',             category: 'powerup',     type: 'circle',  size: 30, sensor: true  },
  { id: 6.3,  name: 'PupTP',             category: 'powerup',     type: 'circle',  size: 30, sensor: true  },
  { id: 6.4,  name: 'PupSpeed',          category: 'powerup',     type: 'circle',  size: 30, sensor: true  },

  { id: 7,    name: 'Spike',             category: 'spike',       type: 'circle',  size: 28, sensor: false  },

  { id: 8,    name: 'Button',            category: 'button',      type: 'circle',  size: 16, sensor: true  },
  { id: 9,    name: 'EmptyGate',         category: 'emptyGate',  type: 'square', size: 40, sensor: true },
  { id: 9.1,  name: 'GreenGate',         category: 'greenGate',  type: 'square', size: 40, sensor: true },
  { id: 9.2,  name: 'RedGate',           category: 'redGate',    type: 'square', size: 40, sensor: true },
  { id: 9.3,  name: 'BlueGate',          category: 'blueGate',   type: 'square', size: 40, sensor: true },

  { id: 13,   name: 'Portal',            category: 'portal',      type: 'circle',  size: 30, sensor: true  },
  { id: 24,   name: 'RedPortal',         category: 'redPortal',   type: 'circle',  size: 30, sensor: true  },
  { id: 25,   name: 'BluePortal',        category: 'bluePortal',  type: 'circle',  size: 30, sensor: true  },

  { id: 22,   name: 'GravityWell',       category: 'gravityWell', type: 'circle',  size: 28, sensor: false  },
{ id: 22.1, name: 'gravityWellField', category: 'gravityWellField', type: 'circle', size: gameConfig.gravityWellRadius*80, sensor: true },
  { id: 21,   name: 'YellowPotato',      category: 'YellowPotato',     type: 'circle',  size: 30, sensor: true  },
  { id: 21.1, name: 'YellowPotatoTaken', category: 'YellowPotato',     type: 'circle',  size: 30, sensor: true  },
  { id: 19,   name: 'RedPotato',         category: 'RedPotato',     type: 'circle',  size: 30, sensor: true  },
  { id: 19.1, name: 'RedPotatoTaken',    category: 'RedPotato',     type: 'circle',  size: 30, sensor: true  },
  { id: 20,   name: 'BluePotato',        category: 'bluePotato',     type: 'circle',  size: 30, sensor: true  },
  { id: 20.1, name: 'BluePotatoTaken',   category: 'bluePotato',     type: 'circle',  size: 30, sensor: true  },
{ id: 11, name: 'RedTeamTile',    category: 'redTeamTile',    type: 'square', size: 40, sensor: true },
{ id: 12, name: 'BlueTeamTile',   category: 'blueTeamTile',   type: 'square', size: 40, sensor: true },
{ id: 23, name: 'YellowTeamTile', category: 'yellowTeamTile', type: 'square', size: 40, sensor: true },

  { id: 'marsball', name: 'Marsball',    category: 'marsball',    type: 'circle',  size: 78, sensor: false },
];