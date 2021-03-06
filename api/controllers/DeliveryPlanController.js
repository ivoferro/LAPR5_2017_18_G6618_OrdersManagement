const request = require("request");
const Promise = require("bluebird");
const join = Promise.join;
const _ = require('underscore');

/**
 * DeliveryPlanController
 *
 * @description :: Server-side logic for managing Deliveryplans
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

module.exports = {

    /**
     * GET /api/DeliveryPlans/detailed
     */
    detailedDeliveryPlan: (req, res) => {

        var today = new Date();
        today.setHours(0, 0, 0, 0);

        var tommorow = new Date();
        tommorow.setHours(23, 59, 0, 0);

        DeliveryPlan.find({ date: { '>': today, '<': tommorow } })
        .populate('VisitedPharmacies')
        .populate('NonVisitedPharmacies')
        .exec((err1, plans) => {
            if (err1) {
                return res.status(400).send(err1);
            }
            if (plans.error) {
                return res.status(400).send(plans.error);
            }

            DeliveryPlanService.mapPlans(plans).then(plansDTO => {
                return res.send(plansDTO);
            })
        });
    },

    /**
     * POST /api/deliveryPlans/new
     */
    createNewDeliveryPlan: (req, res) => {

        // updates date of non delivered orders to be compiled in the next day

        // sets yesterday's date and time at 23:50 (last delivery plan generation time)
        var yesterday1 = new Date();
        yesterday1.setDate(yesterday1.getDate() - 1);
        yesterday1.setHours(0, 0, 0, 0);

        // sets today's date and time at 23:50 (delivery plan generation time)
        var yesterday2 = new Date();
        yesterday2.setDate(yesterday2.getDate() - 1);
        yesterday2.setHours(23, 59, 0, 0);

        Order.find({ orderDate: { '>': yesterday1, '<': yesterday2 } }).exec(function (err, orders) {
            if (err) {
                return res.serverError(err);
            }

            // Reorder non delivered orders
            DeliveryPlanService.reorderNonDelivered(orders, req.body.NonVisitedPharmacies);
            // Create tommorows delivery plan
            DeliveryPlan.create({
                TotalDistance: req.body.Distance,
                VisitedPharmacies: DeliveryPlanService.appendWaypoints(req.body.VisitedPharmacies, req.body.OrderedWaypoints),
                NonVisitedPharmacies: req.body.NonVisitedPharmacies
            }).exec(function (err) {
                if (err) {
                    return res.badRequest(err);
                }
                return res.status(201).json({ message: 'Delivery plan successfully created!' })
            });
        });
    },

    generateDeliveryPlan: (req, res) => {
        var body = {};

        if(req.query.recalculate != 'true') {
            body.url = "https://lapr5-g6618-orders-management.azurewebsites.net/api/deliveryPlans/new";
        }
        if (req.params.algorithm) body.algorithm = req.params.algorithm;
        join(
            Provider.find().limit(1),
            OrdersService.compile(),
            function(provider, orders) {
                body.departure = {
                    name: provider[0].name,
                    latitude: provider[0].latitude,
                    longitude: provider[0].longitude,
                    time: provider[0].timeRestriction
                };

                var pharmNames = _.pluck(orders, 'name');
                var uniqPharms = _.uniq(pharmNames);

                var pharms = _.map(uniqPharms, (pharm) =>{

                   return _.find(orders, (order)=> {
                       return order.name == pharm;
                   });
                });
                body.pharmacies = pharms; 

                var options = {
                    url: 'http://ec2-54-213-7-246.us-west-2.compute.amazonaws.com:3000/calculatePlan',
                    headers: { 'content-type': 'application/json' },
                    json: true,
                    body: body
                };
                request.post(options, function (error, response, reqBody) {
                    if (error) {
                        return res.status(500).json(error);
                    }
                    if (req.query.recalculate == 'true') {

                        // sets yesterday's date and time at 23:50 (last delivery plan generation time)
                        var yesterday1 = new Date();
                        yesterday1.setDate(yesterday1.getDate() - 1);
                        yesterday1.setHours(0, 0, 0, 0);

                        // sets today's date and time at 23:50 (delivery plan generation time)
                        var yesterday2 = new Date();
                        yesterday2.setDate(yesterday2.getDate() - 1);
                        yesterday2.setHours(23, 59, 0, 0);

                        Order.find({ orderDate: { '>': yesterday1, '<': yesterday2 } }).exec(function (err, orders) {
                            if (err) {
                                return res.serverError(err);
                            }

                            // Reorder non delivered orders
                            DeliveryPlanService.reorderNonDelivered(orders, reqBody.NonVisitedPharmacies);
                            // Create tommorows delivery plan
                            DeliveryPlan.create({
                                TotalDistance: reqBody.Distance,
                                VisitedPharmacies: DeliveryPlanService.appendWaypoints(reqBody.VisitedPharmacies, reqBody.OrderedWaypoints),
                                NonVisitedPharmacies: reqBody.NonVisitedPharmacies
                            }).exec(function (err) {
                                if (err) {
                                    return res.badRequest(err);
                                }
                                return res.status(200).json({
                                    message: "Delivery plan recalculated.",
                                    plan: reqBody
                                });
                            });
                        });
                    } else {
                        return res.status(200).json(reqBody);
                    }
                }); 
        }).catch(function(err) {
            res.status(500).json(err);
        });
    }
};






