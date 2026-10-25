# House massing patterns (Scene Kit)

## A. Two-story craftsman with forward garage + front gable  (most common suburban)
Look for: big triangular gable facing the street above the garage/entry, a one-story garage that sticks out, porch beside it.
```js
kit.house({ w: 34, d: 30, h: 20, stories: 2, roofStyle: "gable", ridge: "x", wainscot: "stone",
            porch: { wall: "N", x: -9.5, w: 11, d: 6.5 } });
kit.wing({ wall: "N", offset: 1.5, w: 22, d: 4, h: 21, roofStyle: "gable", ridge: "z", stories: 2 });   // front gable (cross gable)
kit.wing({ wall: "N", offset: 6.5, w: 20, d: 10.5, h: 10.5, roofStyle: "hip", ridge: "x", stories: 1,
           garage: { wall: "N", x: 0, width: 16 } });                                                     // forward 2-car garage
```

## B. Single-story ranch, side-gable
Look for: long low house, eaves facing the street, roof ridge parallel to the street.
```js
kit.house({ w: 60, d: 28, h: 9.5, stories: 1, roofStyle: "gable", ridge: "x", porch: { wall: "N", x: -10, w: 12, d: 6 } });
kit.wing({ wall: "N", offset: 18, w: 22, d: 2, h: 9.5, roofStyle: "gable", ridge: "x", garage: { wall: "N", x: 0, width: 16 } });
```

## C. L-shaped ranch
Look for: two legs at a right angle, each with its own ridge.
```js
kit.house({ w: 48, d: 26, h: 9.5, stories: 1, roofStyle: "hip", ridge: "x" });
kit.wing({ wall: "N", offset: 14, w: 22, d: 20, h: 9.5, roofStyle: "hip", ridge: "z", garage: { wall: "W", x: 0, width: 16 } });
```

## D. Two-story box, hip roof (colonial / tract)
Look for: rectangular two-story, roof sloped on all four sides, no triangles.
```js
kit.house({ w: 40, d: 32, h: 19, stories: 2, roofStyle: "hip", ridge: "x", garage: { wall: "N", x: 9, width: 16 } });
```

## E. Mediterranean / stucco with tile roof
```js
kit.house({ w: 44, d: 36, h: 19, stories: 2, siding: "stucco", roof: "tile", roofStyle: "hip", sidingColor: "#e3d3b8" });
kit.wing({ wall: "N", offset: 12, w: 22, d: 8, h: 10, roof: "tile", roofStyle: "hip", siding: "stucco", garage: { wall: "N", x: 0, width: 16 } });
```

## Reading the roof
- Triangle wall at the end of a roof → gable; ridge runs AWAY from that triangle.
- Roof slopes down toward every side → hip; ridge along the longer side.
- Several triangles facing the street → one cross-gable wing per triangle (shallow d, roofStyle "gable", ridge perpendicular to the wall).
- Lower roof line in front of a taller one → a separate, lower wing (garage, porch roof, one-story section).
