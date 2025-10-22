export const MAX_FPS = 30; // promeni na 30, 60, 144...
export const DEFAULT_MODEL = "assets/boat.glb";
export const BASE_PRICE = 30000; // osnovna cena broda u evrima
export const PART_PRICES = {
  BT_Base_03_A: 0, // default uključen u cenu
  BT_Base_00_B: 450,
  BT_Base_03_B: 500,
  BT_Base_03_C: 700,
  BT_Base_Center_Console_A: 0,
  BT_Base_Center_Console_B: 300,
  BT_Base_Center_Console_C: 450,
};
export const VARIANT_GROUPS = {
  Seats: {
    BT_Base_03_A: {
      mainMat: "M_Leather_A", // samo jedan slot u Blenderu
      models: [
        {
          name: "Standard Seats",
          src: null, // vrati original
          colors: [],
        },
        {
          name: "Comfort Edition",
          src: "variants/BT_Base_03_B.glb",
          colors: [
            {
              name: "Default Leather",
              type: "texture",
              texture: "leather_default.jpg",
            },
            {
              name: "Leather Black",
              type: "texture",
              texture: "leather_black.jpg",
            },
            {
              name: "Leather Brown",
              type: "texture",
              texture: "leather_brown.jpg",
            },
            {
              name: "Leather Brown",
              type: "texture",
              texture: "leather_brown.jpg",
            },
          ],
        },
        {
          name: "Luxury Leather",
          src: "variants/BT_Base_03_C.glb",
          colors: [
            {
              name: "Default Leather",
              type: "texture",
              texture: "leather_default.jpg",
            },
            {
              name: "Leather Black",
              type: "texture",
              texture: "leather_black.jpg",
            },
            {
              name: "Leather Brown",
              type: "texture",
              texture: "leather_brown.jpg",
            },
          ],
        },
      ],
    },
  },
  Hull: {
    BT_Base_00_A: {
      mainMat: "M_Base_Color_Graphics_A", // ime materijala koji se boji
      models: [
        {
          name: "Classic Hull",
          src: null, // vrati original
          colors: [],
        },
        {
          name: "Sport Hull",
          src: "variants/BT_Base_00_B.glb",
          colors: [
            { name: "White", type: "color", color: [1, 1, 1] },
            { name: "Gray", type: "color", color: [0.5, 0.5, 0.5] },
            { name: "Black", type: "color", color: [0.05, 0.05, 0.05] },
          ],
        },
      ],
    },
  },
  "Center Console": {
    BT_Base_Center_Console_A: {
      mainMat: "M_Base_A", // ime materijala koji se boji
      models: [
        {
          name: "Standard Console",
          src: null, // vrati original
          colors: [],
        },
        {
          name: "Premium Console",
          src: "variants/BT_Base_Center_Console_B.glb",
          colors: [
            { name: "White", type: "color", color: [1, 1, 1] },
            { name: "Gray", type: "color", color: [0.5, 0.5, 0.5] },
            { name: "Black", type: "color", color: [0.05, 0.05, 0.05] },
          ],
        },
        {
          name: "Carbon Console",
          src: "variants/BT_Base_Center_Console_C.glb",
          colors: [
            { name: "White", type: "color", color: [1, 1, 1] },
            { name: "Gray", type: "color", color: [0.5, 0.5, 0.5] },
            { name: "Black", type: "color", color: [0.05, 0.05, 0.05] },
          ],
        },
      ],
    },
  },
};
export const BOAT_INFO = {
  Model: "TIARA 56",
  Length: "6.5 m",
  Width: "2.4 m",
  Weight: "1200 kg",
  Capacity: "6 osoba",
  Engine: "Yamaha 150 HP",
  "Max Speed": "70 km/h",
  Material: "Fiberglas",
};
