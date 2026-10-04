/**
 * Scripted WhatsApp-group scenario used by the demo simulator.
 *
 * It deliberately mixes easy and hard cases: plain cancellations, room and time
 * changes, online classes, Hinglish, typos, hedged/ambiguous statements,
 * self-contradicting messages and pure chatter that must never become a change.
 */
export interface SimulatedMessage {
  senderName: string;
  groupName: string;
  /** Minutes before "now" the message was sent. */
  minutesAgo: number;
  text: string;
}

export const SIMULATION_MESSAGES: readonly SimulatedMessage[] = [
  { senderName: 'Rahul', groupName: 'CSE-3A Official', minutesAgo: 360, text: 'DBMS class cancelled today' },
  { senderName: 'Aditya', groupName: 'CSE-3A Official', minutesAgo: 352, text: 'kal DBMS cancel hai' },
  { senderName: 'Priya', groupName: 'CSE-3A Official', minutesAgo: 345, text: "tomorrow's Operating Systems lecture is cancelled" },
  { senderName: 'Rahul', groupName: 'CSE-3A Official', minutesAgo: 338, text: 'OS lab moved from B-202 to A-104' },
  { senderName: 'Prof. Sharma', groupName: 'CSE-3A Official', minutesAgo: 330, text: 'DBMS room changed to C-301 for todays class' },
  { senderName: 'Neha', groupName: 'CSE-3A Official', minutesAgo: 322, text: 'DBMS lecture shifted to 2 PM today' },
  { senderName: 'Anjali', groupName: 'CSE-3A General', minutesAgo: 315, text: 'Does anyone have the DSA notes?' },
  { senderName: 'Karan', groupName: 'CSE-3A Official', minutesAgo: 308, text: 'Reminder: bring your ID cards for the lab' },
  { senderName: 'Rahul', groupName: 'CSE-3A Official', minutesAgo: 300, text: 'I think DBMS is cancelled' },
  { senderName: 'Priya', groupName: 'CSE-3A Official', minutesAgo: 294, text: 'OS lecture today at 11 instead of 9' },
  { senderName: 'Rahul', groupName: 'CSE-3A Official', minutesAgo: 288, text: 'Computer Networks cancelled for today' },
  { senderName: 'Aditya', groupName: 'CSE-3A Official', minutesAgo: 281, text: 'cnclss ki classes h abhi suspended h' },
  { senderName: 'Neha', groupName: 'CSE-3A Official', minutesAgo: 274, text: 'Machine Learning class is on hold till further notice' },
  { senderName: 'Aditya', groupName: 'CSE-3A Official', minutesAgo: 266, text: 'ML lab rescheduled to Saturday 10 AM' },
  { senderName: 'Rahul', groupName: 'CSE-3A Official', minutesAgo: 258, text: 'DBS cancelled' },
  { senderName: 'Neha', groupName: 'CSE-3A Official', minutesAgo: 251, text: 'Maths 3 postponed to Monday' },
  { senderName: 'Karan', groupName: 'CSE-3A Official', minutesAgo: 244, text: 'Please ignore previous msg, DBMS is NOT cancelled' },
  { senderName: 'Priya', groupName: 'CSE-3A Official', minutesAgo: 236, text: 'DBMS will be held online tomorrow' },
  { senderName: 'Anjali', groupName: 'CSE-3A Official', minutesAgo: 228, text: 'DBMS today online on meet, link in the pinned message' },
  { senderName: 'Karan', groupName: 'CSE-3A General', minutesAgo: 220, text: 'Staff meeting at 3 PM, no classes after 3 PM' },
  { senderName: 'Anjali', groupName: 'CSE-3A General', minutesAgo: 212, text: 'OS internal marks viva schedule is out' },
  { senderName: 'Neha', groupName: 'CSE-3A General', minutesAgo: 205, text: 'Library closes at 5 PM on Saturdays' },
  { senderName: 'Rahul', groupName: 'CSE-3A Official', minutesAgo: 198, text: 'Discrete Maths lecture cancelled for the 3rd time' },
  { senderName: 'Aditya', groupName: 'CSE-3A Official', minutesAgo: 190, text: 'DM class cancelled, prof on leave' },
  { senderName: 'Priya', groupName: 'CSE-3A Official', minutesAgo: 182, text: 'DBMS rescheduled to 4 PM sharp' },
  { senderName: 'Neha', groupName: 'CSE-3A Official', minutesAgo: 175, text: 'CNA lab is cancelled today only' },
  { senderName: 'Aditya', groupName: 'CSE-3A Official', minutesAgo: 168, text: 'Kal ka DBMS exam h, classes normal rahenge' },
  { senderName: 'Karan', groupName: 'CSE-3A General', minutesAgo: 160, text: 'Please share the attendance sheet' },
  { senderName: 'Rahul', groupName: 'CSE-3A Official', minutesAgo: 152, text: 'OS room change: A-104 today, B-202 from tomorrow' },
  { senderName: 'Priya', groupName: 'CSE-3A Official', minutesAgo: 145, text: 'DBMS class cancelled for tomorrow' },
];