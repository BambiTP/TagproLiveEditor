const WALL_SOLIDS = {
  '1'  : 0xff,
  '1.1': 0xb4,
  '1.2': 0xd2,
  '1.3': 0x4b,
  '1.4': 0x2d,
};

const renderData = [
{ id: 1,    name: 'wall',             image: 'tiles',       x: null, y: null, size: 40, layer: 'background', hasBackground: false },
{ id: 1.1,  name: '45BL',             image: 'tiles',       x: null, y: null, size: 40, layer: 'background', hasBackground: false },
{ id: 1.2,  name: '45TL',             image: 'tiles',       x: null, y: null, size: 40, layer: 'background', hasBackground: false },
{ id: 1.3,  name: '45TR',             image: 'tiles',       x: null, y: null, size: 40, layer: 'background', hasBackground: false },
{ id: 1.4,  name: '45BR',             image: 'tiles',       x: null, y: null, size: 40, layer: 'background', hasBackground: false },

{ id: 2,    name: 'floor',            image: 'tiles',       x: 13,   y: 4,    size: 40, layer: 'background', hasBackground: false },
{ id: 7,    name: 'spike',            image: 'tiles',       x: 12,   y: 0,    size: 40, layer: 'background', hasBackground: true  },
{ id: 8,    name: 'button',           image: 'tiles',       x: 13,   y: 6,    size: 40, layer: 'background', hasBackground: true  },
{ id: 11,   name: 'redTeamTile',      image: 'tiles',       x: 14,   y: 4,    size: 40, layer: 'background', hasBackground: false },
{ id: 12,   name: 'blueTeamTile',     image: 'tiles',       x: 15,   y: 4,    size: 40, layer: 'background', hasBackground: false },
{ id: 23,   name: 'yellowTeamTile',   image: 'tiles',       x: 13,   y: 5,    size: 40, layer: 'background', hasBackground: false },

{ id: 16,   name: 'yellowFlag',       image: 'tiles',       x: 13,   y: 1,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 16.1, name: 'yellowFlagTaken',  image: 'tiles',       x: 13,   y: 2,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 3,    name: 'redFlag',          image: 'tiles',       x: 14,   y: 1,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 3.1,  name: 'redFlagTaken',     image: 'tiles',       x: 14,   y: 2,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 4,    name: 'blueFlag',         image: 'tiles',       x: 15,   y: 1,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 4.1,  name: 'blueFlagTaken',    image: 'tiles',       x: 15,   y: 2,    size: 40, layer: 'dynamic',    hasBackground: true  },

{ id: 5,    name: 'yellowBoost',      image: 'speedpad',    x: 0,    y: 0,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 5.1,  name: 'yellowBoostTaken', image: 'speedpad',    x: 4,    y: 0,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 14,   name: 'redBoost',         image: 'speedpadRed', x: 0,    y: 0,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 14.1, name: 'redBoostTaken',    image: 'speedpadRed', x: 4,    y: 0,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 15,   name: 'blueBoost',        image: 'speedpadBlue',x: 0,    y: 0,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 15.1, name: 'blueBoostTaken',   image: 'speedpadBlue',x: 4,    y: 0,    size: 40, layer: 'dynamic',    hasBackground: true  },

{ id: 6,    name: 'emptyPup',         image: 'tiles',       x: 12,   y: 8,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 6.1,  name: 'jukeJuice',        image: 'tiles',       x: 12,   y: 4,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 6.2,  name: 'bomb',             image: 'tiles',       x: 12,   y: 5,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 6.3,  name: 'tagpro',           image: 'tiles',       x: 12,   y: 6,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 6.4,  name: 'speed',            image: 'tiles',       x: 12,   y: 7,    size: 40, layer: 'dynamic',    hasBackground: true  },

{ id: 17,   name: 'redGoal',          image: 'tiles',       x: 14,   y: 5,    size: 40, layer: 'background',    hasBackground: false },
{ id: 18,   name: 'blueGoal',         image: 'tiles',       x: 15,   y: 5,    size: 40, layer: 'background',    hasBackground: false },

{ id: 9,    name: 'emptyGate',        image: 'tiles',       x: 12,   y: 3,    size: 40, layer: 'dynamic',    hasBackground: false },
{ id: 9.1,  name: 'greenGate',        image: 'tiles',       x: 13,   y: 3,    size: 40, layer: 'dynamic',    hasBackground: false },
{ id: 9.2,  name: 'redGate',          image: 'tiles',       x: 14,   y: 3,    size: 40, layer: 'dynamic',    hasBackground: false },
{ id: 9.3,  name: 'blueGate',         image: 'tiles',       x: 15,   y: 3,    size: 40, layer: 'dynamic',    hasBackground: false },

{ id: 10,   name: 'bomb',             image: 'tiles',       x: 12,   y: 1,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 10.1, name: 'emptyBomb',        image: 'tiles',       x: 12,   y: 2,    size: 40, layer: 'dynamic',    hasBackground: true  },

{ id: 21,   name: 'yellowPotato',     image: 'tiles',       x: 14,   y: 6,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 21.1, name: 'yellowPotatoTaken',image: 'tiles',       x: 15,   y: 6,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 19,   name: 'redPotato',        image: 'tiles',       x: 14,   y: 7,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 19.1, name: 'redPotatoTaken',   image: 'tiles',       x: 15,   y: 7,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 20,   name: 'bluePotato',       image: 'tiles',       x: 14,   y: 8,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 20.1, name: 'bluePotatoTaken',  image: 'tiles',       x: 15,   y: 8,    size: 40, layer: 'dynamic',    hasBackground: true  },

{ id: 22,   name: 'gravityWell',      image: 'gravitywell', x: 0,    y: 0,    size: 40, layer: 'static',    hasBackground: true  },

{ id: 'redball',  name: 'redBall',    image: 'tiles',       x: 14,   y: 0,    size: 40, layer: 'dynamic',    hasBackground: false },
{ id: 'blueball', name: 'blueBall',   image: 'tiles',       x: 15,   y: 0,    size: 40, layer: 'dynamic',    hasBackground: false },

{ id: 'marsball', name: 'marsBall',   image: 'tiles',       x: 12,   y: 9,    size: 80, layer: 'dynamic',    hasBackground: false },

{ id: 13,   name: 'portal',          image: 'portal',      x: 0,    y: 0,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 24,   name: 'redPortal',       image: 'portalRed',   x: 0,    y: 0,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 25,   name: 'bluePortal',      image: 'portalBlue',  x: 0,    y: 0,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 13.1, name: 'emptyPortal',     image: 'portal',      x: 4,    y: 0,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 24.1, name: 'emptyRedPortal',  image: 'portalRed',   x: 4,    y: 0,    size: 40, layer: 'dynamic',    hasBackground: true  },
{ id: 25.1, name: 'emptyBluePortal', image: 'portalBlue',  x: 4,    y: 0,    size: 40, layer: 'dynamic',    hasBackground: true  },
]