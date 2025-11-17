export const DEFAULT_MODEL = "assets/boat.glb";
export const BASE_PRICE = 30000; // Base boat price in euros.

export const BOAT_INFO = {
  Model: "TIARA 56",
  Length: "6.5 m",
  Width: "2.4 m",
  Weight: "1200 kg",
  Capacity: "6 persons",
  Engine: "Yamaha 150 HP",
  "Max Speed": "70 km/h",
  Material: "Fiberglass",
};

export const VARIANT_GROUPS = {
Seats: {
  BT_Base_03_A: {
    mainMat: "M_Leather_A",
    models: [
      {
        name: "Standard Seats",
        src: null,
        price: 0,
        colors: [],
        description:
          "Durable marine-grade seats designed for everyday comfort and reliability.",
      },
      {
        name: "Comfort Edition",
        src: "variants/BT_Base_03_B.glb",
        price: 500,
        colors: [
          {
            name: "Default Leather",
            type: "texture",
            texture: "leather_default_B_C.jpg",
            normal: "leather_default_N_C.jpg",
            rough: "leather_default_R_C.jpg",
          },
          {
            name: "Leather Black",
            type: "texture",
            texture: "leather_black_B_C.jpg",
            normal: "leather_black_N_C.jpg",
            rough: "leather_black_R_C.jpg",
          },
          {
            name: "Leather Brown",
            type: "texture",
            texture: "leather_brown_B_C.jpg",
            normal: "leather_brown_N_C.jpg",
            rough: "leather_brown_R_C.jpg",
          },
        ],
        description:
          "Enhanced seating with thicker cushions and premium leather textures for a smoother ride.",
      },
      {
        name: "Luxury Leather",
        src: "variants/BT_Base_03_C.glb",
        price: 700,
        colors: [
          {
            name: "Default Leather",
            type: "texture",
            texture: "leather_default_B_C.jpg",
            normal: "leather_default_N_C.jpg",
            rough: "leather_default_R_C.jpg",
          },
          {
            name: "Leather Black",
            type: "texture",
            texture: "leather_black_B_C.jpg",
            normal: "leather_black_N_C.jpg",
            rough: "leather_black_R_C.jpg",
          },
          {
            name: "Leather Brown",
            type: "texture",
            texture: "leather_brown_B_C.jpg",
            normal: "leather_brown_N_C.jpg",
            rough: "leather_brown_R_C.jpg",
          },
        ],
        description:
          "Hand-stitched luxury seating with refined leather finishes and superior ergonomic support.",
      },
    ],
  },
},


  Hull: {
    BT_Base_00_A: {
      mainMat: "M_Base_Color_Graphics_A",
      models: [
        {
          name: "Classic Hull",
          src: null,
          price: 0,
          colors: [],
          description:
            "A standard fiberglass hull offering a perfect balance between weight and strength.",
        },
        {
          name: "Sport Hull",
          src: "variants/BT_Base_00_B.glb",
          price: 450,
          colors: [
            { name: "White", type: "color", color: [1, 1, 1] },
            { name: "Gray", type: "color", color: [0.5, 0.5, 0.5] },
            { name: "Black", type: "color", color: [0.05, 0.05, 0.05] },
          ],
          description:
            "Streamlined sport hull with improved hydrodynamics for higher performance and better control at speed.",
        },
<<<<<<< HEAD
        {
          "name": "Premium Console",
          "src": "variants/BT_Base_Center_Console_B.glb",
          "price": 300,
          "description": "Refined console layout with upgraded materials and added convenience for modern navigation.",
          "colors": [
            {
              "name": "White",
              "type": "color",
              "color": [
                1,
                1,
                1
              ]
            },
            {
              "name": "Gray",
              "type": "color",
              "color": [
                0.502,
                0.502,
                0.502
              ]
            },
            {
              "name": "Black",
              "type": "color",
              "color": [
                0.051,
                0.051,
                0.051
              ]
            }
          ]
        },
        {
          "name": "Carbon Console",
          "src": "variants/BT_Base_Center_Console_C.glb",
          "price": 450,
          "description": "Lightweight carbon-fiber console with a sport-inspired design and precision detailing.",
          "colors": [
            {
              "name": "White",
              "type": "color",
              "color": [
                1,
                1,
                1
              ]
            },
            {
              "name": "Gray",
              "type": "color",
              "color": [
                0.502,
                0.502,
                0.502
              ]
            },
            {
              "name": "Black",
              "type": "color",
              "color": [
                0.051,
                0.051,
                0.051
              ]
            }
          ]
        }
      ]
    }
  },
  "Additional Equipment": {
    "EquipmentGroup": {
      "mainMat": null,
      "models": [
        {
          "name": "Standard Package",
          "src": null,
          "price": 0,
          "description": "Includes all essential onboard accessories for safe and comfortable cruising.",
          "colors": []
        },
        {
          "name": "Premium Sound System",
          "src": null,
          "price": 900,
          "description": "High-end marine audio system with multiple waterproof speakers and rich surround sound.",
          "colors": []
        },
        {
          "name": "GPS Navigation",
          "src": null,
          "price": 750,
          "description": "Advanced GPS navigation unit with touchscreen and real-time route tracking.",
          "colors": []
        },
        {
          "name": "Underwater Lights",
          "src": null,
          "price": 650,
          "description": "LED underwater lighting package for nighttime ambiance and enhanced visibility.",
          "colors": []
        }
      ]
    }
  },
  "Additional Equipment3": {
    "EquipmentGroup2": {
      "mainMat": null,
      "models": [
        {
          "name": "Standard Package3",
          "src": null,
          "price": 0,
          "description": "Complete starter set including essential safety gear, ropes, and dock accessories.",
          "colors": []
        },
        {
          "name": "Premium Sound System2",
          "src": null,
          "price": 1900,
          "description": "Upgraded audio setup with subwoofers and an integrated Bluetooth amplifier for superior sound clarity.",
          "colors": []
        },
        {
          "name": "GPS Navigation2",
          "src": null,
          "price": 1750,
          "description": "Full-featured marine GPS with expanded chart coverage and customizable navigation profiles.",
          "colors": []
        },
        {
          "name": "Underwater Lights2",
          "src": null,
          "price": 1650,
          "description": "Premium underwater LED system with adjustable colors and high output illumination.",
          "colors": []
        }
      ]
    }
  }
};
export const SIDEBAR_INFO = {
  "contact": "\n  <form id=\"contactForm\" class=\"contact-form\">\n    <p><b>Get in touch</b><br>\n    Have a question or project in mind? Send us a message below.</p>\n\n    <label>Name</label>\n    <input type=\"text\" name=\"name\" placeholder=\"Your name\" required>\n\n    <label>Email</label>\n    <input type=\"email\" name=\"email\" placeholder=\"Your email\" required>\n\n    <label>Message</label>\n    <textarea name=\"message\" placeholder=\"Write your message here...\" rows=\"4\" required></textarea>\n\n    <button type=\"submit\">Send Message</button>\n  </form>\n",
  "help": "Quick troubleshooting and usage guide for the Less Engine.",
  "about": "\n  <p><b>Less Engine</b> is the technology that brings every model to life. It turns complex 3D design into a smooth, realistic, and interactive experience — right inside your browser, with no downloads or apps required.</p>\n\n  <p><b>How it works</b><br>\n  Every surface, reflection, and color you see reacts naturally to light and movement. The engine was built from the ground up to capture how materials truly look and feel — from polished metal and glass to the ocean surface and sky above.</p>\n\n  <p><b>Why it stands out</b><br>\n  Less Engine focuses on realism, speed, and immersion. It’s not just about viewing a model — it’s about feeling the product as if it were right in front of you. Each change in color, material, or detail appears instantly and seamlessly.</p>\n\n  <p><b>What it enables</b><br>\n  • Instantly customize and preview any configuration<br>\n  • Export beautiful presentation PDFs with images and pricing<br>\n  • Maintain smooth performance on any modern device<br>\n  • Present products in natural light and realistic environments<br>\n  • Adapt the experience to any brand or design style</p>\n\n  <p><b>The idea behind it</b><br>\n  Less Engine was created to close the gap between imagination and reality. It allows customers to explore, interact, and connect with the product — not just see it. That’s what makes it more than software. It’s a full experience.</p>\n",
  "settings": "Customize preferences, performance options, and camera sensitivity here."
};

export const CLIENTS = [
  {
    name: "Demo Client",
    slug: "demo-client",
    boatInfo: { ...BOAT_INFO },
    variantGroups: JSON.parse(JSON.stringify(VARIANT_GROUPS)),
  },
];
=======
      ],
    },
  },

  "Center Console": {
    BT_Base_Center_Console_A: {
      mainMat: "M_Base_A",
      models: [
        {
          name: "Standard Console",
          src: null,
          price: 0,
          colors: [],
          description:
            "Functional and compact center console providing all essential controls and storage options.",
        },
        {
          name: "Premium Console",
          src: "variants/BT_Base_Center_Console_B.glb",
          price: 300,
          colors: [
            { name: "White", type: "color", color: [1, 1, 1] },
            { name: "Gray", type: "color", color: [0.5, 0.5, 0.5] },
            { name: "Black", type: "color", color: [0.05, 0.05, 0.05] },
          ],
          description:
            "Refined console layout with upgraded materials and added convenience for modern navigation.",
        },
        {
          name: "Carbon Console",
          src: "variants/BT_Base_Center_Console_C.glb",
          price: 450,
          colors: [
            { name: "White", type: "color", color: [1, 1, 1] },
            { name: "Gray", type: "color", color: [0.5, 0.5, 0.5] },
            { name: "Black", type: "color", color: [0.05, 0.05, 0.05] },
          ],
          description:
            "Lightweight carbon-fiber console with a sport-inspired design and precision detailing.",
        },
      ],
    },
  },

  "Additional Equipment": {
    EquipmentGroup: {
      mainMat: null,
      models: [
        {
          name: "Standard Package",
          src: null,
          price: 0,
          colors: [],
          description:
            "Includes all essential onboard accessories for safe and comfortable cruising.",
        },
        {
          name: "Premium Sound System",
          src: null,
          price: 900,
          description:
            "High-end marine audio system with multiple waterproof speakers and rich surround sound.",
        },
        {
          name: "GPS Navigation",
          src: null,
          price: 750,
          description:
            "Advanced GPS navigation unit with touchscreen and real-time route tracking.",
        },
        {
          name: "Underwater Lights",
          src: null,
          price: 650,
          description:
            "LED underwater lighting package for nighttime ambiance and enhanced visibility.",
        },
      ],
    },
  },

  "Additional Equipment3": {
    EquipmentGroup2: {
      mainMat: null,
      models: [
        {
          name: "Standard Package3",
          src: null,
          price: 0,
          colors: [],
          description:
            "Complete starter set including essential safety gear, ropes, and dock accessories.",
        },
        {
          name: "Premium Sound System2",
          src: null,
          price: 1900,
          description:
            "Upgraded audio setup with subwoofers and an integrated Bluetooth amplifier for superior sound clarity.",
        },
        {
          name: "GPS Navigation2",
          src: null,
          price: 1750,
          description:
            "Full-featured marine GPS with expanded chart coverage and customizable navigation profiles.",
        },
        {
          name: "Underwater Lights2",
          src: null,
          price: 1650,
          description:
            "Premium underwater LED system with adjustable colors and high output illumination.",
        },
      ],
    },
  },
};

export const SIDEBAR_INFO = {
  contact: `
  <form id="contactForm" class="contact-form">
    <p><b>Get in touch</b><br>
    Have a question or project in mind? Send us a message below.</p>

    <label>Name</label>
    <input type="text" name="name" placeholder="Your name" required>

    <label>Email</label>
    <input type="email" name="email" placeholder="Your email" required>

    <label>Message</label>
    <textarea name="message" placeholder="Write your message here..." rows="4" required></textarea>

    <button type="submit">Send Message</button>
  </form>
`,
help: "Quick troubleshooting and usage guide for the Less Engine.",

about: `
  <p><b>Less Engine</b> is the technology that brings every model to life. It turns complex 3D design into a smooth, realistic, and interactive experience — right inside your browser, with no downloads or apps required.</p>

  <p><b>How it works</b><br>
  Every surface, reflection, and color you see reacts naturally to light and movement. The engine was built from the ground up to capture how materials truly look and feel — from polished metal and glass to the ocean surface and sky above.</p>

  <p><b>Why it stands out</b><br>
  Less Engine focuses on realism, speed, and immersion. It’s not just about viewing a model — it’s about feeling the product as if it were right in front of you. Each change in color, material, or detail appears instantly and seamlessly.</p>

  <p><b>What it enables</b><br>
  • Instantly customize and preview any configuration<br>
  • Export beautiful presentation PDFs with images and pricing<br>
  • Maintain smooth performance on any modern device<br>
  • Present products in natural light and realistic environments<br>
  • Adapt the experience to any brand or design style</p>

  <p><b>The idea behind it</b><br>
  Less Engine was created to close the gap between imagination and reality. It allows customers to explore, interact, and connect with the product — not just see it. That’s what makes it more than software. It’s a full experience.</p>
`,

  settings: "Customize preferences, performance options, and camera sensitivity here."
};
>>>>>>> parent of b0360b2 (admin)


