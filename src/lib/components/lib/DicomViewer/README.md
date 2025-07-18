```
@/../dwv/dist/dwv.min.js
```

```

        // console.table({
        //   patientName: meta['00100010']?.value?.[0], // (0020,0013) patientName
        //   instanceNumber: meta['00200013']?.value?.[0], // (0020,0013) InstanceNumber
        //   sliceLocation: meta['00201041']?.value?.[0], // (0020,1041)
        //   thickness: meta['00180050']?.value?.[0], // (0018,0050) SliceThickness
        //   windowCenter: meta['00281050']?.value?.[0], // (0028,1050)
        //   windowWidth: meta['00281051']?.value?.[0], // (0028,1051)
        //   sopClass: meta['00080016']?.value?.[0], // (0008,0016)
        //   uid: imageUid,
        // });


        app.addEventListener('renderend', (event: { dataid: number }) => {});

            /**
     * @event type DicomLoadStartEvent
     */
    app.addEventListener('loadstart', () => {
      // showDropbox(app, false);
    });

      const tools = {
    Scroll: {},
    ZoomAndPan: {},
    WindowLevel: {},
    Draw: {
      // options: ['Ruler'],
      options: ['Rectangle'],
      type: 'factory',
    },
  };
```
