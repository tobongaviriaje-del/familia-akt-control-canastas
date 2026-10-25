 const http=require('http');
const fs=require('fs');
const path=require('path');

const PORT=process.env.PORT||8080;
const ROOT=path.join(__dirname,'public');
const DATA_DIR=path.join(__dirname,'data');
const STATE_FILE=path.join(DATA_DIR,'state.json');
const HISTORY_DIR=path.join(DATA_DIR,'history');
const sessions=new Map();
const SESSION_TTL=12*60*60*1000;
const crypto=require('crypto');
function hashPassword(password){const salt=crypto.randomBytes(16).toString('hex');const digest=crypto.scryptSync(String(password),salt,64).toString('hex');return 'scrypt$'+salt+'$'+digest;}
function verifyPassword(user,password){if(!user||typeof password!=='string')return false;if(typeof user.passHash==='string'){const parts=user.passHash.split('$');if(parts.length!==3||parts[0]!=='scrypt'||!/^[a-f0-9]{128}$/i.test(parts[2]))return false;try{const expected=Buffer.from(parts[2],'hex');const actual=crypto.scryptSync(password,parts[1],expected.length);return expected.length===actual.length&&crypto.timingSafeEqual(expected,actual);}catch{return false;}}if(typeof user.pass==='string'){const x=Buffer.from(user.pass),y=Buffer.from(password);return x.length===y.length&&crypto.timingSafeEqual(x,y);}return false;}
function publicUser(user){const {pass,passHash,...safe}=user||{};return safe;}
function normalizeUsersForStorage(users){if(!users||typeof users!=='object'||Array.isArray(users))throw new Error('Lista de usuarios inválida');const out={};for(const [key,value] of Object.entries(users)){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Usuario inválido');const user={...value};if(typeof user.pass==='string'&&user.pass.length){user.passHash=hashPassword(user.pass);delete user.pass;}else if(typeof user.passHash!=='string')throw new Error('Cada usuario debe tener contraseña');out[key]=user;}return out;}
