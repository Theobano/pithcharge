import React from 'react';
import Link from 'next/link';
import { StationDetails } from '@pithcharge/cms-adapters';
import { useStationStatus, useMyActiveSessions } from '../api/cmsApi';

interface StationCardProps {
  station: StationDetails;
}

export const StationCard: React.FC<StationCardProps> = ({ station }) => {
  const { data: liveStatus } = useStationStatus(station.id);
  const { data: mySessions } = useMyActiveSessions(station.id);

  const stationLabel = station.label || station.ocppConnectionName || station.id;

  return (
    <div className="border border-gray-200 bg-white p-5 shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
        <div>
          <h3 className="font-semibold text-lg text-gray-900">{stationLabel}</h3>
          <p className="text-xs text-gray-500">{station.id} • {station.vendor || 'Generic'} {station.model || 'Station'}</p>
        </div>
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            station.isOnline ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}
        >
          {station.isOnline ? 'Online' : 'Offline'}
        </span>
      </div>

      {/* Location */}
      <p className="text-sm text-gray-600 mb-4">
        {station.hubId ? `Hub: ${station.hubId}` : 'Location details not available'}
      </p>

      {/* EVSE List */}
      <div className="space-y-3">
        {station.evses.map((evse) => {
          const statusInfo = liveStatus?.evses.find((e) => e.evseId === evse.evseId);
          const currentStatus = statusInfo?.status || evse.status;
          const mySession = mySessions?.find((s) => s.evseId === evse.evseId);

          return (
            <div
              key={evse.evseId}
              className="flex items-center justify-between bg-gray-50 p-3 rounded-lg text-sm transition-all duration-200 ease-out"
            >
              <div>
                <span className="font-medium text-gray-700">EVSE #{evse.evseId}</span>
                <span className="ml-2 text-xs text-gray-500">
                  ({evse.connectors.map((c) => `${c.type} ${c.maxPowerKw}kW`).join(', ')})
                </span>
              </div>

              <div className="flex items-center space-x-2">
                <span className={`text-xs px-2 py-1 rounded font-mono ${
                  currentStatus === 'Available' ? 'bg-green-100 text-green-700' :
                  currentStatus === 'Charging' ? 'bg-blue-100 text-blue-700 font-semibold' : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {currentStatus}
                </span>

                {mySession && (
                  <Link
                    href={`/sessions/${mySession.id}`}
                    className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs font-medium transition active:scale-[0.98]"
                  >
                    Your session
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};