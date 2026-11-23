/**
 * A synthetic study (no real patient data) as a TAR archive, and the same
 * TAR compressed by the real `bzip2` and `xz` tools (there is no bzip2 or
 * xz encoder in the browser bundle). `localImport.decompress.spec.ts`
 * checks that each fixture decompresses to exactly `buildTar(tarStudy())`.
 *
 * To regenerate after changing the study or the synthetic DICOM writer:
 * write `tarOf(tarStudy())` to `study.tar` (e.g. from a test), then
 * `bzip2 -9 -c study.tar | base64 -w0` and
 * `xz -6 --check=crc64 -c study.tar | base64 -w0`. The `ZEROS_*` fixtures are
 * 4 MiB of zero bytes (`head -c 4194304 /dev/zero | bzip2 -9 | base64 -w0`,
 * same with `xz -6`): a valid, empty, highly compressible TAR stream.
 */
import { syntheticDicom } from './syntheticDicom';
import { buildTar, fromBase64 } from './syntheticTar';

export const TAR_STUDY_1 = '2.25.300';
export const TAR_STUDY_2 = '2.25.400';

export const tarSlice = (series: string, n: number) =>
  syntheticDicom({
    studyUid: series.startsWith(TAR_STUDY_2) ? TAR_STUDY_2 : TAR_STUDY_1,
    seriesUid: series,
    sopUid: `${series}.${n}`,
    instanceNumber: n,
    seriesNumber: Number(series.split('.').pop()),
    seriesDescription: `Series ${series}`,
  });

/**
 * Two Studies, three Series, nested folders, extensionless and `.dcm`
 * files, a Series spread over two folders, a DICOMDIR and a README.
 */
export const tarStudy = (): Record<string, Uint8Array> => ({
  'TarStudy/Study_001/Series_001/IM000001': tarSlice(`${TAR_STUDY_1}.1`, 1),
  'TarStudy/Study_001/Series_001/IM000002': tarSlice(`${TAR_STUDY_1}.1`, 2),
  'TarStudy/Study_001/Series_001/more/IM000003': tarSlice(`${TAR_STUDY_1}.1`, 3),
  'TarStudy/Study_001/Series_002/IM000001.dcm': tarSlice(`${TAR_STUDY_1}.2`, 1),
  'TarStudy/Study_001/Series_002/IM000002.dcm': tarSlice(`${TAR_STUDY_1}.2`, 2),
  'TarStudy/Study_002/a/b/c/000001': tarSlice(`${TAR_STUDY_2}.1`, 1),
  'TarStudy/Study_002/000002': tarSlice(`${TAR_STUDY_2}.1`, 2),
  'TarStudy/DICOMDIR': syntheticDicom({
    sopClassUid: '1.2.840.10008.1.3.10',
    pixels: false,
  }),
  'TarStudy/README.txt': Uint8Array.from('Synthetic test study.\n', (c) => c.charCodeAt(0)),
});

/** Files as a TAR archive, with directory entries for each folder. */
export const tarOf = (files: Record<string, Uint8Array>) => {
  const directories = new Set<string>();
  for (const path of Object.keys(files)) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) directories.add(`${segments.slice(0, i).join('/')}/`);
  }
  return buildTar([
    ...[...directories].map((name) => ({ name, type: '5' })),
    ...Object.entries(files).map(([name, data]) => ({ name, data })),
  ]);
};

export const TAR_STUDY_BZ2 = fromBase64(
  'QlpoOTFBWSZTWVTT9b4ACZx//////dPHT//7fu/f5/5/vnDhw4cOHDhw4cOXDhxACAAIUAW+AAAAAABA2qqBoAAaAAaD' +
  'QAAGQAGgBkAAAGgyAAAAAaIMmAEwJhMTQ0YmJgEwCZA0NGmIwE0MAQwIMmAAAEwgyYATAmExNDRiYmATAJkDQ0aYjATQ' +
  'wBDAgyYAAATCDJgBMCYTE0NGJiYBMAmQNDRpiMBNDAEMCDJgAABMBUkSZJpoNARkmKPakaeU2moNpqPU2p6CPU00bTQN' +
  'Ro9QZqGIAAAAADRpYUPQQ8Do+q6PS6NqWqe4Pq2dqun1IUM0muiqHt+3X/bLYHL2xtz0PUksXJG6KIVJQOpJ2RaSTuSV' +
  'AmEkwksg3ZN7AYJMJYWktZJaS4wkrwBgkzhUnIKGMlxUlDJDMFDFYdbrcVfEvThphjWnhX5smzJyScknOkwk0oc8h0LU' +
  '2aaKqlKqeuhZDkG+j36Ook2BwDCOZf3zhi8ulKLLLFhhyppQyFpgKnMGqS4xGYcA5QynSTwylFia8lcA6Y5ck6ckrwxu' +
  'Di6lVVVVVVVVVgNrKpKk1haTTJhJfUNQsCbsmtJlJsSYSTzR20lhcVJjeQW529z7WqsBMITMQoKkqI+YLLipEuLipLVm' +
  'zY2tVebJ8keeMRmGiaZ2chs4pNgXklSWFlDanHJ37yezJQ7lSTrTzBaSe77gzSXRNCNcWHXnFLDjrMk5k+NObx5pNQtJ' +
  'ZwxxMBLi8upyxS1Sqipx2LS2MlpM0N+SoeN8WvHnYnx8yTTJURUlSdmeRPJ9ja2BUqlVsopR4qSySx2hSnWSbi4ljCSY' +
  '0qrlCihLSQovCUkpGZJcS9dv6V77ne72GGnNa17VWN7ipJczTFg1Q183XktCYUIV2bSVJRG0JQvUCbUXVSopVVVVVUi0' +
  'Cej0/OZ254PwPIp6fJreU7mbzKVTmiGok7yTeFQ1CYIVgKhLSSoYC02rKrDd28RN4ZFCigsh1XiotWWVkuKRijEsvRSh' +
  'FxKQxuksyoksLdjqyVeGtJSZxnGdnSZriyKjCc6S5Lk4pQpQpRYTHKHFQwFTCSHzdjzplm29rJn02kS7Yxduaba8hik6' +
  'AlIwy0SG3bWwtXn7cNbOk3ZIbOeaKzazTeVfG8mLXlrIWswYZsMwyePkz1jCawmeZNM0Wh3J6Ytv+6nNHWHGO6OEdAZ3' +
  'pWkyheSShQ6A5+fwcAsPRxHdGCw9SdUZTuyfOEmPqjehiGgaYodIdLNlCZxoHYFDXGE2ImrKpLybwwF5OEfQGmfKGUOV' +
  'Jo2pN+TAb8qTvChyxsN7ZG0MpNQ3YJiGkbgVJNEk1h6SFSS3+MBthvDQPc+/5OUtVVSqqVnA8SSoiojPNSL6tYdocAw8' +
  'IPCEcY4hwT6c3R43l9elCpSlGiBwnlodBC09dIU509Z4j1p7SDnuTY4ZJoDT30hRIYh5U155Vmy1JDvvrT5BD2WQfYlB' +
  '2K3ELc1D6KHsfZ35DN7SQzpC/BA5e+gtBCT1tjFCSYJCTBRw9vAhBibmabpvTQb46HdScBw8RxnJynMc/QdJ1dZ2Hb3H' +
  'eeHieR5+h6ntJIXufB8/R9n5+n8PIFIP8XckU4UJBU0/W+A='
);
export const TAR_STUDY_XZ = fromBase64(
  '/Td6WFoAAATm1rRGBMC0BoCQASEBFgAAAAAAAIS9JibgR/8DLF0AKhhKRTwn11ZagGfWcRsHwxK7+MMdpU/bB6gAR7V0' +
  'foSKPoVZYi83ru0EsJZToYd5iYDoZA+jsoeA+wyMZsqGmFG44AlZz6lS82p5OCqfF8XohqC3C1y1YUxRF39RJFfMJvZF' +
  'NOI2twMELgeVrOg7uARJ48YEpUjIZggdDkHGsBYTsVwkwIMj066to9svAwKmkkGf8lEoJKF61JyaVYQ/4Q2h2ZMLkDWf' +
  'j8EW0l+j3x9EX727UJJcZOMa2/DKfnS/ir/BNV+Mwi8/FBzzHPI6bpnXLx0C6785S1PH45fsJri/Q0e9vA41LY0WyLhQ' +
  'zm4g/DtIsX00wgQh+TVarcKKkl4h15ajJCNwYEtuMFYUf2eGp73mkKeEek9gSWmHOLtcLHUgvwFcfbkvg4Tujx8V1G0b' +
  '+U8o9MipDldGBk6QYu2DhIQqlvzuhL6QK+RQ+iWGkXpK7dwqW88d2WcjVxyXoHfrCBIoCEwGBlLWVt8ildDT627B/OZV' +
  'Bfl6qhYUtmBeXIbYya7FYTkV5gmVyGjkJATpNRJ6fT3omN7eYa92gpeUzw2/+vJJg00rGOZne+3iIGNz+kJ42S53Tvd/' +
  'W59Mfukg0d7XURzLLl7MUOJ6Tg0ErNVWXhZK48U4+keto2SBaNIdPMNVvXSf49iDZfzOSh1xhsxbCs3XfLAHotpPV1CC' +
  'yofCuxEjTxnjOa/U6xPuZx8Vw1qo5NH8/Mv7jA0e8bbqjF8JN1lGBY0IVHntAc22kFgsrVNjFQgv5bO7hWDRM78oz6ke' +
  't9RwhvSKki6Wq1tt25ECuZmwmZw0DvnKCA/htE0ZHoC4CLSO2GPgEk7Tib1VKe4Zq00u19E+nCo8rAmNSrcanOK4kE/k' +
  '8c1o+/1YH9ZB37BypGBISSBpGocNG9QFEzQsuzr6/DH6+KhZVjptVOSrUH7ue0A79LV4UEJjvUzFjlRIeFO9LItS4a6m' +
  'CavztfYlW1uASR7UBqFUksHyTuPJD7jExNG8J7WUmRYz0zpAEvmJWwSOLSgVt1wHQiTJHKHjUCJlR+fsW4cVUdnS6sQf' +
  'H7MhCOP5pDC3utqGL6MVWS0bjRKSWjEAunFjO8l3UCgAAdAGgJABANgCelexxGf7AgAAAAAEWVo='
);
export const ZEROS_BZ2 = fromBase64(
  'QlpoOTFBWSZTWVYC4ogAICBIAMAAAAQACCAAMMwFKaYCAbECAeLuSKcKEgrAXFEA'
);
export const ZEROS_XZ = fromBase64(
  '/Td6WFoAAATm1rRGBMCwBYCAgAIhARYAAAAAAFNnjRD//xEBbF0AAG/9//+jt/9HPkgVcjlhUbiSKOajhgf57uQegtMv' +
  'xTo8AUuxfsmKik0vow3Zf6bjjCMRU+BZGMV1iuJ3+LaUfwxqwN50SWTi6VxTsgTY90QMq18NbUbp5cN2iLeWV6y2TeFp' +
  'HW/7S4gQbELLiD9cAI/QTq8mKJRxHz2PJOFwnqcjX+woy4XRlZiKfiqR8id19xnABphNmP3Yr9WQD8QlU/j1kTYxBaWw' +
  '7m/BcE1HDNGREaqtYB26zrEnGFxZhulmUli+6XasWeTlWwUI+cfarfz7Uit0zR5bIEL53VM9+ClkCTuAyyps37U78MS9' +
  'Ll+qDz5LZkKQEw7/EJP4cXhZ+AvN/5UoRg+p/Hze+5owLlbAj4Xzg4HAZcQlU/j1kTYxBaWw7m/BcE1HDNGREaqtYB26' +
  'zrEnGFxZhulmUli+6XasWeTlWwUI+cfarfz7Uit0zR5bIEL53VM9+ClkCTuAyyps37U78MS8SCfmWJ//EAErAOxzU6f9' +
  'vq58MRqft40xbnCepyNf7CjLhdGVmIp+KpHyJ3X3GcAGmE2Y/div1ZAPxCVT+PWRNjEFpbDub8FwTUcM0ZERqq1gHbrO' +
  'sScYXFmG6WZSWL7pdqxZ5OVbBQj5x9qt/PtSK3TNHlsgQvndUz34KWQJO4DLKmzftTvwxL0uX6oPPktmQpATDv8Qk/hx' +
  'eFn4C83/lShGD6n8fN77mjAuVsCPhfODgcBlxCVT+PWRNjEFpbDub8FwTUcM0ZERqq1gHbrOsScYXFmG6WZSWL7pdqxZ' +
  '5OVbBQj5x9qt/PtSK3TNHlsgQvndUz34KWQJO4DLKmzftTvwxL0uX6oPPktmQpATDv8Qk/hxeFn4C83/lShGD6n8fN77' +
  'mjAuVsCPhfODgcBlxCVRDz+ygAHcAAUAQeqmLQAAa2xFfNIJYdsAAcwFgICAAr7RfrSxxGf7AgAAAAAEWVo='
);
