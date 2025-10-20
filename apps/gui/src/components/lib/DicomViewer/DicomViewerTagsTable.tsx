import { FC, useEffect, useState } from 'react';
import Search from '@mui/icons-material/Search';
import { getTagFromKey } from 'dwv';
import styled from '@emotion/styled';
import {
  Box,
  InputAdornment,
  Paper,
  Slider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
} from '@mui/material';

const PREFIX = 'TagsTableAll';
const classes = {
  flex: `${PREFIX}-flex`,
  spacer: `${PREFIX}-spacer`,
  searchField: `${PREFIX}-searchField`,
  slider: `${PREFIX}-slider`,
  container: `${PREFIX}-container`,
};

const Root = styled('div')(() => ({
  [`& .${classes.flex}`]: {
    flex: 1,
  },

  [`& .${classes.spacer}`]: {
    flex: '1 1 100%',
  },

  [`& .${classes.searchField}`]: {
    width: '45%',
  },

  [`& .${classes.slider}`]: {
    margin: 20,
  },

  [`&.${classes.container}`]: {
    padding: 10,
    overflow: 'hidden',
  },
}));

interface DicomViewerTagsTableProps {
  data: Record<string, unknown>;
}

export const DicomViewerTagsTable: FC<DicomViewerTagsTableProps> = ({
  data,
}) => {
  const [searchfor, setSearchfor] = useState('');
  const [instanceNumbers, setInstanceNumbers] = useState<number[]>([]);
  const [instanceNumber, setInstanceNumber] = useState(0);
  const [sliderMin, setSliderMin] = useState(0);
  const [sliderMax, setSliderMax] = useState(0);
  const [displayData, setDisplayData] = useState<any[]>([]);
  const isDicomMeta = (meta: Record<string, unknown>) => {
    return typeof meta['00020010'] !== 'undefined';
  };
  const getDicomTagReducer = (
    tagData: any,
    instanceNumber: number,
    prefix: string
  ) => {
    return (accumulator: any[], currentValue: string) => {
      const tag = getTagFromKey(currentValue);
      let key = tag.getNameFromDictionary();
      if (typeof key === 'undefined') {
        // add 'x' to help sorting
        key = 'x' + tag.getKey();
      }
      const name = key;
      const element = tagData[currentValue];
      let value = element.value;
      // possible 'merged' object
      // (use slice method as test for array and typed array)
      if (
        typeof value.slice === 'undefined' &&
        typeof value[instanceNumber] !== 'undefined'
      ) {
        value = value[instanceNumber];
      }
      // force instance number (otherwise takes value in non indexed array)
      if (name === 'InstanceNumber') {
        value = instanceNumber;
      }
      // recurse for sequence
      if (element.vr === 'SQ') {
        // sequence tag
        accumulator.push({
          name: (prefix ? prefix + ' ' : '') + name,
          value: '',
        });
        // sequence value
        for (let i = 0; i < value.length; ++i) {
          const sqItems = value[i];
          const keys = Object.keys(sqItems);
          const res = keys.reduce(
            getDicomTagReducer(sqItems, instanceNumber, prefix + '[' + i + ']'),
            []
          );
          accumulator = accumulator.concat(res);
        }
      } else {
        // shorten long 'o'ther data
        if (element.vr[0] === 'O' && value.length > 10) {
          value =
            value.slice(0, 10).toString() + '... (len:' + value.length + ')';
        }
        accumulator.push({
          name: (prefix ? prefix + ' ' : '') + name,
          value: value.toString(),
        });
      }
      return accumulator;
    };
  };
  const getTagReducer = (tagData: any) => {
    return function (accumulator: any[], currentValue: string) {
      accumulator.push({
        name: currentValue,
        value: tagData[currentValue].value,
      });
      return accumulator;
    };
  };
  const getMetaArray = (instanceNumber: number) => {
    let reducer;
    if (isDicomMeta(data)) {
      reducer = getDicomTagReducer(data, instanceNumber, '');
    } else {
      reducer = getTagReducer(data);
    }
    const keys = Object.keys(data);
    return keys.reduce(reducer, []);
  };
  const filterList = (search: string, instanceNumber: number) => {
    const searchLo = search.toLowerCase();
    const metaArray = getMetaArray(instanceNumber);
    const updatedList = metaArray.filter(function (item: any) {
      for (const key in item) {
        let value = item[key];
        if (typeof value !== 'undefined') {
          if (typeof value !== 'string') {
            value = value.toString();
          }
          if (value.toLowerCase().indexOf(searchLo) !== -1) {
            return true;
          }
        }
      }
      return false;
    });
    setSearchfor(search);
    setDisplayData(updatedList);
  };
  const onSearch = (event: any) => {
    filterList(event.target.value, instanceNumber);
  };
  const onSliderChange = (event: any) => {
    const sliderValue = parseInt(event.target.value, 10);
    const instanceNumber = instanceNumbers[sliderValue];
    const metaArray = getMetaArray(instanceNumber);
    setInstanceNumber(instanceNumber);
    setDisplayData(metaArray);
    filterList(searchfor, instanceNumber);
  };

  useEffect(() => {
    const instanceElement = data['00200013'] as any;

    if (typeof instanceElement !== 'undefined') {
      let instanceNumberValue = instanceElement.value;
      if (typeof instanceNumberValue === 'string') {
        instanceNumberValue = [instanceNumberValue];
      }
      // convert string to numbers

      const instanceNumbers = instanceNumberValue
        .map(Number)
        .sort((a: any, b: any) => a - b);
      const sliderMin = 0;
      const instanceNumber = instanceNumbers[sliderMin];
      setInstanceNumbers(instanceNumbers);
      setSliderMin(sliderMin);
      setSliderMax(instanceNumbers.length - 1);
      setInstanceNumber(instanceNumber);
      setDisplayData(getMetaArray(instanceNumber));
    }
  }, []);

  return (
    <Root className={classes.container}>
      <Stack direction="row" spacing={2}>
        <TextField
          id="search"
          type="search"
          value={searchfor}
          className={classes.searchField}
          onChange={onSearch}
          margin="normal"
          size="small"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search />
                </InputAdornment>
              ),
            },
          }}
        />
        <Box width={300} display="flex" alignItems="center">
          <Slider
            title="Instance number"
            className={classes.slider}
            marks
            min={sliderMin}
            max={sliderMax}
            onChange={onSliderChange}
          />
          <div title="Instante number">{instanceNumber}</div>
        </Box>
      </Stack>
      <Paper sx={{ width: '100%', overflow: 'hidden' }}>
        <TableContainer sx={{ maxHeight: 400 }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Tag</TableCell>
                <TableCell>Value</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {displayData.map((item, index) => {
                return (
                  <TableRow key={index}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>{item.value}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Root>
  );
};
