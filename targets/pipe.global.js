import Pipe, * as PipeAPI from '../pipe.mjs';

const PipeGlobal = Object.assign(Pipe, PipeAPI);

globalThis.Pipe = PipeGlobal;