import { styled, alpha } from '@mui/material/styles';
import Menu, { MenuProps } from '@mui/material/Menu';

export default styled((props: MenuProps) => (
  <Menu
    component="div"
    elevation={0}
    anchorOrigin={{
      vertical: 'bottom',
      horizontal: 'right',
    }}
    transformOrigin={{
      vertical: 'top',
      horizontal: 'right',
    }}
    {...props}
  />
))(({ theme }) => ({
  '& .MuiPaper-root': {
    borderRadius: 16,
    marginTop: '21px',
    minWidth: 305,
    '& .MuiMenu-list': {
      padding: '16px',
    },
    '& .MuiMenuItem-root': {
      paddingLeft: '0',
      paddingRight: '0',
      '&:active': {
        backgroundColor: alpha(
          theme.palette.primary.main,
          theme.palette.action.selectedOpacity
        ),
      },
    },
  },
}));
