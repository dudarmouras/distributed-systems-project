'use strict';

jest.mock('../src/state/store');
jest.mock('../src/state/persistence');

const request = require('supertest');
const express = require('express');
const { getStats, getAllServices, getRecentEvents } = require('../src/state/store');
const router = require('../src/routes/monitoring');

const app = express();
app.use(express.json());
app.use('/', router);

beforeEach(() => {
  getStats.mockReturnValue({
    status: 'ok',
    uptimeSeconds: 60,
    servicesMonitored: 2,
    totalIngestsReceived: 10,
    totalValidationErrors: 0,
    serverStartedAt: new Date(),
  });
  getAllServices.mockReturnValue([
    { probe_id: 'probe_pagamentos', status: 'ONLINE', uptime: 30, latencia: 145 },
    { probe_id: 'probe_cache',      status: 'DOWN',   uptime: 10, latencia: 2 },
  ]);
  getRecentEvents.mockReturnValue([]);
});

test('GET /health retorna 200 com status ok', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
});

test('GET /services retorna a lista de serviços monitorados', async () => {
  const res = await request(app).get('/services');
  expect(res.status).toBe(200);
  expect(res.body.services).toHaveLength(2);
  expect(res.body.services[0]).toHaveProperty('probe_id');
  expect(res.body.services[0]).toHaveProperty('status');
});

test('GET /events retorna o histórico de eventos', async () => {
  const res = await request(app).get('/events');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('events');
});
