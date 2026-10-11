const mongoose = require('mongoose');

const familySchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 100 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Family || mongoose.model('Family', familySchema);
