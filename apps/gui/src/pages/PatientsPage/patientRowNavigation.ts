import type { MouseEvent } from 'react';
import { generatePath } from 'react-router-dom';
import {
  GRID_CHECKBOX_SELECTION_FIELD,
  GridCellModes,
  GridCellParams,
  MuiEvent,
} from '@mui/x-data-grid';
import { guiRoutes } from '@libs/constants';
import { GetPatientsResponse } from '@libs/schemas';

type Patient = GetPatientsResponse[0];

/** Patient details URL: the route identity is the slug. */
export const getPatientPath = (slug: string) =>
  generatePath(guiRoutes.patient, { slug });

/** Trashed patients have no valid details page. */
export const isPatientNavigable = (patient: Patient) =>
  !patient.deletedAt && !!patient.slug;

/** Cells whose own controls (ID copy, row actions, selection) own the click. */
const OWN_CLICK_FIELDS = new Set(['id', GRID_CHECKBOX_SELECTION_FIELD]);

/**
 * A cell whose ordinary click opens the patient: a live row, a cell in view
 * mode that is neither editable (a click there starts editing) nor an
 * action/control cell.
 */
export const isPatientCellNavigable = (params: GridCellParams<Patient>) =>
  isPatientNavigable(params.row) &&
  params.cellMode === GridCellModes.View &&
  !params.isEditable &&
  params.colDef.type !== 'actions' &&
  !OWN_CLICK_FIELDS.has(params.field);

/**
 * Real interactive descendants of a cell (links, buttons, form controls):
 * they perform their own action, so the cell click must not navigate too.
 */
const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  'label',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
].join(',');

const hasTextSelection = () => {
  const selection = window.getSelection?.();
  return !!selection && !selection.isCollapsed && !!selection.toString();
};

/**
 * Whether a DataGrid `cellClick` is a plain "open this patient" click:
 * a primary unmodified click on a navigable cell, not on an interactive
 * descendant, not from a portal rendered inside the cell (e.g. a
 * confirmation dialog) and not ending a text selection.
 */
export const shouldOpenPatientOnCellClick = (
  params: GridCellParams<Patient>,
  event: MuiEvent<MouseEvent<HTMLElement>>
) => {
  if (event.defaultPrevented || event.defaultMuiPrevented) {
    return false;
  }
  if (
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return false;
  }
  if (!isPatientCellNavigable(params)) {
    return false;
  }
  const cell = event.currentTarget;
  const target = event.target;
  // React bubbles portal events through the component tree, not the DOM.
  if (!(target instanceof Element) || !cell.contains(target)) {
    return false;
  }
  const interactive = target.closest(INTERACTIVE_SELECTOR);
  if (interactive && cell.contains(interactive)) {
    return false;
  }
  return !hasTextSelection();
};
